/** Demo records for an empty Torix workspace (internal preview). */
export function sampleWorkspace(now = new Date().toISOString()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(
    new Date(),
  );
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const clientMarketing = "seed-client-marketing";
  const clientBilling = "seed-client-billing";
  const clientDev = "seed-client-dev";
  const staffA = "seed-staff-aisha";
  const staffB = "seed-staff-bilal";
  const staffC = "seed-staff-sara";
  const orderMkt = "seed-order-mkt";
  const orderBill = "seed-order-bill";
  const orderDev = "seed-order-dev";

  const records = [
    {
      id: "seed-settings",
      kind: "settings",
      data: {
        companyName: "Torix Solutions",
        currency: "PKR",
        timezone: "Asia/Karachi",
        departments: ["Marketing", "Medical Billing", "Development", "Corporate"],
        address: "Karachi, Pakistan",
        email: "ops@torix.example",
        phone: "+92 300 0000000",
        invoicePrefix: "TX-INV",
        workingDays: [1, 2, 3, 4, 5],
        holidays: [],
        payrollDays: 30,
        defaultLeaveDays: 14,
        autoIssueInvoices: false,
        maintenanceEnabled: true,
        bankDetails: "Demo bank account — replace in Settings",
        paymentTerms: "Payment due within 14 days.",
      },
    },
    {
      id: clientMarketing,
      kind: "client",
      data: {
        name: "Northstar Clinics",
        contact: "Dr. Nadia Khan",
        email: "nadia@northstar.example",
        phone: "+92 321 1111111",
        department: "Marketing",
        status: "Active",
      },
    },
    {
      id: clientBilling,
      kind: "client",
      data: {
        name: "Harbor Medical Group",
        contact: "James Cole",
        email: "james@harbor.example",
        phone: "+1 212 555 0101",
        department: "Medical Billing",
        status: "Active",
      },
    },
    {
      id: clientDev,
      kind: "client",
      data: {
        name: "Lumen Retail",
        contact: "Sara Malik",
        email: "sara@lumen.example",
        phone: "+92 333 2222222",
        department: "Development",
        status: "Active",
      },
    },
    {
      id: staffA,
      kind: "staff",
      data: {
        name: "Aisha Rahman",
        email: "aisha@torix.example",
        department: "Marketing",
        title: "Account Manager",
        salary: 18000000,
        currency: "PKR",
        status: "Active",
        startDate: "2025-01-15",
      },
    },
    {
      id: staffB,
      kind: "staff",
      data: {
        name: "Bilal Ahmed",
        email: "bilal@torix.example",
        department: "Medical Billing",
        title: "Billing Specialist",
        salary: 16000000,
        currency: "PKR",
        status: "Active",
        startDate: "2025-03-01",
      },
    },
    {
      id: staffC,
      kind: "staff",
      data: {
        name: "Sara Hussain",
        email: "sara.h@torix.example",
        department: "Development",
        title: "Full-stack Engineer",
        salary: 22000000,
        currency: "PKR",
        status: "Active",
        startDate: "2024-11-01",
      },
    },
    {
      id: orderMkt,
      kind: "order",
      data: {
        name: "Northstar growth retainer",
        clientId: clientMarketing,
        department: "Marketing",
        amount: 45000000,
        currency: "PKR",
        date: today,
        due: nextWeek,
        status: "Active",
        model: "Retainer",
        scope: "Monthly content + ads management",
      },
    },
    {
      id: orderBill,
      kind: "order",
      data: {
        name: "Harbor AR recovery",
        clientId: clientBilling,
        department: "Medical Billing",
        amount: 1200000,
        currency: "USD",
        date: today,
        due: nextWeek,
        status: "Active",
        model: "Fixed project",
        scope: "Denial cleanup and follow-up",
      },
    },
    {
      id: orderDev,
      kind: "order",
      data: {
        name: "Lumen booking portal",
        clientId: clientDev,
        department: "Development",
        amount: 85000000,
        currency: "PKR",
        date: today,
        due: nextWeek,
        status: "Active",
        model: "Fixed project",
        scope: "Web app MVP for appointments",
      },
    },
    {
      id: "seed-lead-1",
      kind: "lead",
      data: {
        name: "City Dental outreach",
        contact: "Omar Farooq",
        email: "omar@citydental.example",
        department: "Marketing",
        stage: "Qualified",
        value: 25000000,
        currency: "PKR",
        nextFollowup: nextWeek,
        note: "Interested in local SEO package",
      },
    },
    {
      id: "seed-task-1",
      kind: "task",
      data: {
        name: "Ship October campaign report",
        orderId: orderMkt,
        assignee: staffA,
        department: "Marketing",
        due: nextWeek,
        status: "In progress",
      },
    },
    {
      id: "seed-task-2",
      kind: "task",
      data: {
        name: "Clear aged denials batch",
        orderId: orderBill,
        assignee: staffB,
        department: "Medical Billing",
        due: today,
        status: "Submitted",
      },
    },
    {
      id: "seed-task-3",
      kind: "task",
      data: {
        name: "Finish booking calendar API",
        orderId: orderDev,
        assignee: staffC,
        department: "Development",
        due: nextWeek,
        status: "In progress",
      },
    },
    {
      id: "seed-invoice-1",
      kind: "invoice",
      data: {
        name: "TX-INV-1001",
        number: "TX-INV-1001",
        clientId: clientMarketing,
        department: "Marketing",
        currency: "PKR",
        rate: 1000000,
        amount: 45000000,
        status: "Draft",
        date: today,
        due: nextWeek,
        lines: [
          {
            id: "seed-line-1",
            description: "October retainer",
            amount: 45000000,
            department: "Marketing",
            orderId: orderMkt,
          },
        ],
      },
    },
    {
      id: "seed-leave-1",
      kind: "leave",
      data: {
        name: "Annual leave — Aisha",
        employeeId: staffA,
        department: "Marketing",
        start: nextWeek,
        end: nextWeek,
        days: 1,
        type: "Annual",
        status: "Submitted",
        note: "Family appointment",
      },
    },
  ];

  const events = [
    {
      id: "seed-event-capital",
      kind: "capital",
      amount: 50000000,
      date: `${month}-01`,
      department: "Corporate",
      clientId: "",
      orderId: "",
      person: "Owner",
      note: "Opening owner capital (demo)",
      ledger: [
        { account: "cash", amount: 50000000, units: 50000000, currency: "PKR", accountId: "default-pkr" },
        { account: "equity", amount: -50000000, units: -50000000, currency: "PKR" },
      ],
      reverses: null,
      createdAt: now,
      meta: { currency: "PKR", note: "Opening owner capital (demo)" },
    },
  ];

  return { records, events };
}
