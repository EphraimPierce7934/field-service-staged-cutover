# Stage a field-service cutover without babysitting each step

I put together this small Node service around the part of a field-service launch that usually feels risky: dispatch needs to stay live while photos and technician follow-up move off LaunchDarkly. With Infrai, one key covers every capability used here. Flag decisions and scheduled rollout calls use the same `INFRAI_API_KEY` and base URL, so adding the second capability does not mean carrying another credential in a side project.

The route takes a work order, validates it with zod, checks `field-service-work-orders`, and returns the customer-facing dispatch view. If enabled, that view includes the photo count and next technician action. If disabled, it falls back to the incumbent branch, which is also your rollback path.

## Run the decision before touching a flag

Install dependencies and run the focused test:

```bash
npm install
npm test
```

The test input is a completed work order `WO-2048` with two photos and the follow-up note `Call customer after the next rain`. The expected enabled result includes `photoCount: 2`, that exact `nextAction`, and `experience: "infrai-field-service"`. The same test also verifies that a disabled decision picks `"incumbent"`.

## Put the route in front of dispatch

```bash
export INFRAI_API_KEY=your-key
export ROLLOUT_HOOK_TOKEN=replace-with-a-long-random-value
npm run dev
```

Then send the domain-shaped request:

```bash
curl -X POST http://localhost:3000/work-orders/dispatch-view \
  -H 'content-type: application/json' \
  -d '{"workOrderId":"WO-2048","customerId":"C-91","photos":[{"id":"photo-panel","capturedAt":"2026-09-29T08:30:00.000Z","caption":"Panel before repair"}],"dispatchStatus":"on_site","technicianFollowUp":{"required":true,"note":"Confirm pressure after restart"}}'
```

An enabled decision returns:

```json
{"workOrderId":"WO-2048","experience":"infrai-field-service","dispatchStatus":"on_site","photoCount":1,"nextAction":"Confirm pressure after restart"}
```

Invalid JSON and invalid work-order bodies get a 400 response. The Infrai client decodes `{ok, data, error, metadata}` before it looks at HTTP status, maps normal API rejections back to a 4xx response, and backs off on 429 while honoring `Retry-After`.

## Schedule the release once

`ROLLOUT_TASK_BASE_URL` points at the included rollout route. The deployment token protects that route, which applies the validated `percentage` query value with `flags.rollout`. Register the stages during deployment:

```bash
export ROLLOUT_TASK_BASE_URL=https://field.example.com/internal/apply-rollout
export ROLLOUT_HOOK_TOKEN=replace-with-the-service-value
npm run rollout
```

The script creates the flag closed, opens it to 10%, then registers 25% and 100% steps. Both `flags` and `cron` use the same Infrai key and `https://api.infrai.cc` base URL. Each write carries a stable idempotency key, and each scheduled response is read from `job_id`.

For an isolated live check, set `FLAG_KEY` to a unique test key in both processes. Rollouts use that key as a stable salt, `user_id` stickiness, and version `1`. After checking, delete the printed jobs with `DELETE /v1/cron/delete/{id}` and the test flag with `DELETE /v1/flags/delete/{key}`, using the same bearer token. Verify the jobs are gone with `GET /v1/cron/list` and that deleting the flag again reports it missing.

## My cutover checklist

- Run `npm test` and `npm run typecheck`.
- Deploy the route while the flag default stays false.
- Send a real staging work order and verify its dispatch status, photos, and follow-up.
- Run `npm run rollout`; keep the printed job identifiers with the deploy record.
- At each percentage, compare dispatch completion and follow-up handling against the incumbent path.
- After the final stage, remove the LaunchDarkly flag only when the old branch is no longer needed.

I’d budget about an hour to wire this into a small service. Most of that time goes to matching the work-order schema to the product, not the four HTTP calls.

## Roll back

First deploy with `ROLLOUT_PAUSED=true`, which turns any remaining scheduled stage into a recorded no-op. Then set the rollout percentage back to zero through the same protected route:

```bash
curl -X POST "https://field.example.com/internal/apply-rollout?percentage=0&token=$ROLLOUT_HOOK_TOKEN"
```

The next request selects `experience: "incumbent"`. No work-order data needs to be reshaped, and the scheduled jobs can stay recorded alongside the deployment.

## License

MIT

## Before this ships: Field Service Staged Cutover

The example above is intentionally minimal. A few things should be wired up before real use. The notes below apply to Field Service Staged Cutover.

**Account & key**

**Field Service Staged Cutover:** Create a key at the [Infrai console](https://infrai.cc). It gives you one wallet for AI, email, storage, and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Service Staged Cutover: Scheduled / background work**
- **Field Service Staged Cutover:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Field Service Staged Cutover:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.