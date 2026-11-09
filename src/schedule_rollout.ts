import { infrai } from "./infrai_client.js";
import { FLAG_KEY } from "./dispatch_service.js";

const rolloutBaseUrl = process.env.ROLLOUT_TASK_BASE_URL;
if (!rolloutBaseUrl) throw new Error("Set ROLLOUT_TASK_BASE_URL to the public rollout handler URL");
const rolloutToken = process.env.ROLLOUT_HOOK_TOKEN;
if (!rolloutToken) throw new Error("Set ROLLOUT_HOOK_TOKEN for the rollout handler");

await infrai.flags.set(FLAG_KEY, false, `${FLAG_KEY}:initialize`);
await infrai.flags.rollout(FLAG_KEY, 10, `${FLAG_KEY}:rollout:10`);

const stages = [
  { cron_expr: "0 14 * * 2", percentage: 25 },
  { cron_expr: "0 14 * * 4", percentage: 100 },
];

for (const stage of stages) {
  const task = new URL(rolloutBaseUrl);
  task.searchParams.set("percentage", String(stage.percentage));
  task.searchParams.set("token", rolloutToken);
  const result = await infrai.cron.create(
    { cron_expr: stage.cron_expr, task: task.toString() },
    `${FLAG_KEY}:schedule:${stage.percentage}`,
  );
  console.log(`Scheduled ${stage.percentage}% rollout as ${result.job_id}`);
}
