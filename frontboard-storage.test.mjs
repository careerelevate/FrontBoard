import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { test } from "node:test";

class SupabaseMock {
  constructor() {
    this.user = null;
    this.consents = [];
    this.documents = [];
    this.objects = new Map();
    this.auth = {
      signInWithIdToken: async () => {
        this.user = { id: "user-uuid", email: "traveler@example.com", user_metadata: { name: "Traveler" } };
        return { data: { user: this.user }, error: null };
      },
      getUser: async () => ({ data: { user: this.user }, error: null }),
      signOut: async () => {
        this.user = null;
        return { error: null };
      }
    };
    this.storage = {
      from: (bucket) => ({
        upload: async (path, blob) => {
          assert.equal(bucket, "frontboard-private");
          this.objects.set(path, blob);
          return { error: null };
        },
        download: async (path) => ({
          data: this.objects.get(path) || null,
          error: this.objects.has(path) ? null : new Error("Object not found")
        }),
        remove: async (paths) => {
          for (const path of paths) this.objects.delete(path);
          return { error: null };
        }
      })
    };
  }

  from(table) {
    const query = {
      table,
      action: "select",
      filters: [],
      select() { return this; },
      order() { return this; },
      eq(column, value) { this.filters.push([column, value]); return this; },
      insert(value) { this.action = "insert"; this.value = value; return this; },
      delete() { this.action = "delete"; return this; },
      maybeSingle() { return this.execute(true); },
      single() { return this.execute(true); },
      then(resolve, reject) { return this.execute().then(resolve, reject); },
      async execute(single = false) {
        const rows = table === "frontboard_storage_consents" ? this.parent.consents : this.parent.documents;
        if (this.action === "insert") {
          const row = { ...this.value, uploaded_at: new Date().toISOString() };
          rows.push(row);
          return { data: single ? row : null, error: null };
        }
        const matches = rows.filter((row) =>
          this.filters.every(([column, value]) => row[column] === value)
        );
        if (this.action === "delete") {
          for (const row of matches) rows.splice(rows.indexOf(row), 1);
          return { data: null, error: null };
        }
        return { data: single ? matches[0] || null : matches, error: null };
      }
    };
    query.parent = this;
    return query;
  }
}

test("keeps authenticated documents private, consent-gated, and deletable as a pair", async () => {
  const supabase = new SupabaseMock();
  const window = {
    FRONTBOARD_CONFIG: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_test"
    },
    supabase: { createClient: () => supabase }
  };
  const context = createContext({ window, crypto: webcrypto, Blob, TextEncoder });
  const source = await readFile(new URL("./frontboard-storage.js", import.meta.url), "utf8");
  runInContext(source, context);

  await assert.rejects(window.frontboardStorage.getConsent(), /Sign in with Google again/);
  const user = await window.frontboardStorage.signInWithGoogle("google-id-token");
  assert.equal(user.id, "user-uuid");
  const initialConsent = await window.frontboardStorage.getConsent();
  assert.equal(initialConsent.accepted, false);
  assert.equal(initialConsent.version, null);

  await window.frontboardStorage.acceptConsent("1");
  const acceptedConsent = await window.frontboardStorage.getConsent();
  assert.equal(acceptedConsent.accepted, true);
  assert.equal(acceptedConsent.version, "1");

  const file = new Blob(["ticket pdf"], { type: "application/pdf" });
  file.name = "ticket.pdf";
  const records = [{ document: { document_type: "Flight" } }];
  const { document } = await window.frontboardStorage.uploadDocument(file, records);
  assert.match(document.original_path, /^users\/user-uuid\/FrontBoard\/[^/]+\/original\.pdf$/);
  assert.match(document.record_path, /^users\/user-uuid\/FrontBoard\/[^/]+\/record\.json$/);

  const listed = await window.frontboardStorage.listDocuments();
  assert.equal(listed.documents.length, 1);
  assert.equal(JSON.stringify(listed.documents[0].records), JSON.stringify(records));
  assert.equal((await window.frontboardStorage.downloadOriginal(listed.documents[0])).size, file.size);
  assert.equal(supabase.objects.size, 2);

  await window.frontboardStorage.deleteDocument(listed.documents[0]);
  assert.equal((await window.frontboardStorage.listDocuments()).documents.length, 0);
  assert.equal(supabase.objects.size, 0);

  await window.frontboardStorage.signOut();
  await assert.rejects(window.frontboardStorage.listDocuments(), /Sign in with Google again/);
});
