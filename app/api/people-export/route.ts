export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import {context,assertOrigin} from "@/lib/server";
import {can} from "@/lib/access.mjs";
import {safeCsv} from "@/lib/domain.mjs";
import {balanceSummary} from "@/lib/leave-balance.mjs";
import {employeePartialLedger} from "@/lib/partial-absence.mjs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "live";
    const type = url.searchParams.get("type") || "attendance";
    const c = await context(mode);
    if (!can(c.access, "leave.read") && !can(c.access, "attendance.read") && !can(c.access, "*")) {
      return Response.json({ error: "Not permitted." }, { status: 403 });
    }
    let rows: any[][] = [];
    if (type === "attendance") {
      rows = [["id", "employeeId", "date", "state", "clockIn", "clockOut", "workedMinutes", "breakMinutes", "lateMinutes", "classification", "status"]];
      for (const r of c.records.filter((x) => x.kind === "attendance" && !x.archived)) {
        const d = r.data;
        rows.push([r.id, d.employeeId, d.date, d.state, d.clockIn, d.clockOut, d.workedMinutes, d.breakMinutes, d.lateMinutes, d.classification, d.status]);
      }
    } else if (type === "late") {
      rows = [["id", "employeeId", "date", "lateMinutes", "converted", "status"]];
      for (const r of c.records.filter((x) => x.kind === "attendance" && !x.archived && x.data.lateMinutes > 0)) {
        rows.push([r.id, r.data.employeeId, r.data.date, r.data.lateMinutes, r.data.lateConverted ? "yes" : "no", r.data.status]);
      }
    } else if (type === "leave") {
      rows = [["id", "employeeId", "type", "unit", "start", "end", "units", "quarters", "status", "approvedBy"]];
      for (const r of c.records.filter((x) => x.kind === "leave" && !x.archived)) {
        const d = r.data;
        rows.push([r.id, d.employeeId, d.type, d.unit, d.start, d.end, d.units, d.quarters, d.status, d.approvedBy || ""]);
      }
    } else if (type === "balances") {
      rows = [["employeeId", "type", "availableDays", "grantedDays", "usedDays", "pendingDays"]];
      const staff = c.records.filter((x) => x.kind === "staff" && !x.archived);
      for (const s of staff) {
        for (const t of ["Annual", "Sick", "Casual"]) {
          const b = balanceSummary(c.records, s.id, t);
          rows.push([s.id, t, b.availableDays, b.grantedDays, b.usedDays, b.pendingDays]);
        }
      }
    } else if (type === "partial") {
      rows = [["employeeId", "entryId", "kind", "units", "charged", "date", "sourceId"]];
      for (const s of c.records.filter((x) => x.kind === "staff" && !x.archived)) {
        for (const e of employeePartialLedger(c.records, s.id)) {
          rows.push([s.id, e.id, e.kind, e.units, e.charged, e.date, e.sourceId]);
        }
      }
    } else if (type === "grants") {
      rows = [["id", "employeeId", "type", "amount", "effectiveDate", "expiryDate", "status", "reason"]];
      for (const r of c.records.filter((x) => x.kind === "leavegrant" && !x.archived)) {
        const d = r.data;
        rows.push([r.id, d.employeeId, d.type, d.amount, d.effectiveDate, d.expiryDate, d.status, d.reason]);
      }
    } else {
      return Response.json({ error: "Unknown export type." }, { status: 400 });
    }
    const csv = safeCsv(rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="torix-people-${type}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Export failed.";
    return Response.json({ error }, { status: /Sign in/.test(error) ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  assertOrigin(request);
  return GET(request);
}
