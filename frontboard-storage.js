(() => {
  const config = window.FRONTBOARD_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    throw new Error("Supabase URL and publishable key must be configured in frontboard-config.js.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("Supabase could not load. Check your internet connection and reload FrontBoard.");
  }

  const BUCKET = "frontboard-private";
  const DOCUMENTS_TABLE = "frontboard_documents";
  const CONSENTS_TABLE = "frontboard_storage_consents";
  const CONSENT_VERSION = "1";
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const MAX_RECORDS = 25;
  const MAX_RECORDS_SIZE = 256 * 1024;
  const MIME_TYPES = {
    pdf: "application/pdf",
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain"
  };
  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  function throwIfError(error, operation) {
    if (error) {
      throw new Error(`${operation}: ${error.message || "Supabase request failed."}`);
    }
  }

  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    throwIfError(error, "Could not verify your signed-in account");
    if (!data.user) throw new Error("Sign in with Google again to access private documents.");
    return data.user;
  }

  function userPrefix(userId) {
    return `users/${userId}/FrontBoard/`;
  }

  async function removeObjects(paths) {
    if (!paths.length) return;
    const { error } = await client.storage.from(BUCKET).remove(paths);
    throwIfError(error, "Could not clean up uploaded files");
  }

  async function getConsent() {
    const user = await requireUser();
    const { data, error } = await client
      .from(CONSENTS_TABLE)
      .select("consent_version")
      .eq("user_id", user.id)
      .eq("consent_version", CONSENT_VERSION)
      .maybeSingle();
    throwIfError(error, "Could not check storage consent");
    return { accepted: Boolean(data), version: data?.consent_version || null };
  }

  async function acceptConsent(version) {
    if (version !== CONSENT_VERSION) throw new Error("Unsupported storage consent version.");
    const user = await requireUser();
    if ((await getConsent()).accepted) return;

    const { error } = await client.from(CONSENTS_TABLE).insert({
      user_id: user.id,
      consent_version: version
    });
    throwIfError(error, "Could not save your storage consent");
  }

  async function uploadDocument(file, records) {
    const user = await requireUser();
    if (!file || typeof file.name !== "string") throw new Error("Choose a supported document to upload.");
    const extension = file.name.split(".").pop().toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) throw new Error("Only PDF, CSV, JSON, and TXT documents can be saved.");
    if (file.size > MAX_FILE_SIZE) throw new Error("Documents must be 15 MB or smaller.");
    if (!Array.isArray(records) || records.length > MAX_RECORDS) {
      throw new Error(`A document can contain up to ${MAX_RECORDS} extracted travel records.`);
    }

    const serializedRecords = JSON.stringify(records);
    if (new TextEncoder().encode(serializedRecords).length > MAX_RECORDS_SIZE) {
      throw new Error("The extracted travel details are too large to save.");
    }

    const documentId = crypto.randomUUID();
    const prefix = `${userPrefix(user.id)}${documentId}/`;
    const originalPath = `${prefix}original.${extension}`;
    const recordPath = `${prefix}record.json`;
    const uploadedPaths = [];

    try {
      const { error: originalError } = await client.storage.from(BUCKET).upload(originalPath, file, {
        contentType,
        upsert: false
      });
      throwIfError(originalError, "Could not upload the original document");
      uploadedPaths.push(originalPath);

      const { error: recordError } = await client.storage.from(BUCKET).upload(
        recordPath,
        new Blob([serializedRecords], { type: MIME_TYPES.json }),
        { contentType: MIME_TYPES.json, upsert: false }
      );
      throwIfError(recordError, "Could not upload the extracted travel details");
      uploadedPaths.push(recordPath);

      const { data, error } = await client
        .from(DOCUMENTS_TABLE)
        .insert({
          id: documentId,
          user_id: user.id,
          source_document: file.name,
          file_extension: extension,
          record_count: records.length,
          original_path: originalPath,
          record_path: recordPath
        })
        .select("id, user_id, source_document, uploaded_at, file_extension, record_count, original_path, record_path")
        .single();
      throwIfError(error, "Could not save document details");

      return {
        document: {
          ...data,
          uploadedAt: data.uploaded_at,
          fileExtension: data.file_extension,
          recordCount: data.record_count,
          records
        }
      };
    } catch (error) {
      try {
        await removeObjects(uploadedPaths);
      } catch (cleanupError) {
        throw new Error(`${error.message} Temporary upload cleanup also failed: ${cleanupError.message}`);
      }
      throw error;
    }
  }

  async function listDocuments() {
    const user = await requireUser();
    const { data, error } = await client
      .from(DOCUMENTS_TABLE)
      .select("id, user_id, source_document, uploaded_at, file_extension, record_count, original_path, record_path")
      .eq("user_id", user.id)
      .order("uploaded_at", { ascending: false });
    throwIfError(error, "Could not list saved documents");

    const documents = await Promise.all((data || []).map(async (row) => {
      if (!row.record_path.startsWith(userPrefix(user.id))) {
        throw new Error("A saved document has an invalid storage path.");
      }
      const { data: recordBlob, error: recordError } = await client.storage.from(BUCKET).download(row.record_path);
      throwIfError(recordError, `Could not download travel details for ${row.source_document}`);

      let records;
      try {
        records = JSON.parse(await recordBlob.text());
      } catch (error) {
        throw new Error(`Travel details for ${row.source_document} are invalid JSON: ${error.message}`);
      }
      if (!Array.isArray(records)) throw new Error(`Travel details for ${row.source_document} are not a record list.`);

      return {
        ...row,
        uploadedAt: row.uploaded_at,
        fileExtension: row.file_extension,
        recordCount: row.record_count,
        records
      };
    }));

    return { documents };
  }

  async function downloadOriginal(document) {
    const user = await requireUser();
    if (!document?.original_path?.startsWith(userPrefix(user.id))) {
      throw new Error("This document does not belong to the signed-in account.");
    }
    const { data, error } = await client.storage.from(BUCKET).download(document.original_path);
    throwIfError(error, `Could not download ${document.source_document || "the original document"}`);
    return data;
  }

  async function deleteDocument(document) {
    const user = await requireUser();
    if (!document?.id) throw new Error("Choose a saved document to delete.");

    const { data, error } = await client
      .from(DOCUMENTS_TABLE)
      .select("id, original_path, record_path")
      .eq("id", document.id)
      .eq("user_id", user.id)
      .maybeSingle();
    throwIfError(error, "Could not find the saved document");
    if (!data) throw new Error("This saved document no longer exists.");

    const prefix = userPrefix(user.id);
    if (!data.original_path.startsWith(prefix) || !data.record_path.startsWith(prefix)) {
      throw new Error("This document does not belong to the signed-in account.");
    }

    await removeObjects([data.original_path, data.record_path]);
    const { error: deleteError } = await client
      .from(DOCUMENTS_TABLE)
      .delete()
      .eq("id", document.id)
      .eq("user_id", user.id);
    throwIfError(deleteError, "The files were removed, but their document details could not be deleted");
  }

  window.frontboardStorage = {
    signInWithGoogle(token) {
      return client.auth.signInWithIdToken({ provider: "google", token }).then(({ data, error }) => {
        throwIfError(error, "Google sign-in failed");
        if (!data.user) throw new Error("Google sign-in did not return a user.");
        return data.user;
      });
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      throwIfError(error, "Could not sign out");
    },
    getConsent,
    acceptConsent,
    listDocuments,
    uploadDocument,
    deleteDocument,
    downloadOriginal
  };
})();
