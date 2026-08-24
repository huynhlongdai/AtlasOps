import { ApprovalStore, type ApprovalStatus } from "./approval.js";

function usage(): never {
  console.error("Usage: atlasops-operator <list [status] | approve <id> [operator] | reject <id> [operator]>");
  process.exit(2);
}

const [, , command, ...args] = process.argv;
if (!command) usage();
const store = new ApprovalStore(process.env.ATLASOPS_APPROVALS_FILE ?? "./data/approvals.json");

if (command === "list") {
  const status = args[0] as ApprovalStatus | undefined;
  const records = await store.list(status);
  console.log(JSON.stringify(records, null, 2));
} else if (command === "approve") {
  const id = args[0]; if (!id) usage();
  const operator = args[1] ?? process.env.USER ?? "local-operator";
  console.log(JSON.stringify(await store.approve(id, operator), null, 2));
} else if (command === "reject") {
  const id = args[0]; if (!id) usage();
  const operator = args[1] ?? process.env.USER ?? "local-operator";
  console.log(JSON.stringify(await store.reject(id, operator), null, 2));
} else usage();
