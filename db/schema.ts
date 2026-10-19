import { pgTable, text, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    mode: text("mode").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [uniqueIndex("workspace_user_mode").on(t.userId, t.mode)],
);

export const records = pgTable(
  "records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    archived: integer("archived").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    sourceKey: text("source_key"),
  },
  (t) => [
    index("records_workspace_kind").on(t.workspaceId, t.kind),
    uniqueIndex("record_source_key").on(t.workspaceId, t.kind, t.sourceKey),
  ],
);

export const events = pgTable(
  "finance_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    date: text("event_date").notNull(),
    department: text("department").notNull(),
    clientId: text("client_id"),
    orderId: text("order_id"),
    person: text("person"),
    note: text("note").notNull(),
    ledger: text("ledger").notNull(),
    reverses: text("reverses"),
    createdAt: text("created_at").notNull(),
    meta: text("meta").notNull().default("{}"),
  },
  (t) => [
    index("events_workspace_date").on(t.workspaceId, t.date),
    uniqueIndex("event_single_reversal").on(t.workspaceId, t.reverses),
  ],
);

export const audit = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    action: text("action").notNull(),
    recordId: text("record_id").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
    actor: text("actor").notNull().default("Owner"),
  },
  (t) => [index("audit_workspace").on(t.workspaceId)],
);

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const members = pgTable(
  "company_members",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    email: text("email").notNull(),
    userId: text("user_id"),
    role: text("role").notNull(),
    departments: text("departments").notNull(),
    grants: text("grants").notNull(),
    employeeId: text("employee_id"),
    active: integer("active").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("member_company_email").on(t.companyId, t.email)],
);

export const operations = pgTable("operations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  createdAt: text("created_at").notNull(),
});
