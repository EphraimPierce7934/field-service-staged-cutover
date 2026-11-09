import assert from "node:assert/strict";
import test from "node:test";
import { WorkOrderRequest, buildDispatchView } from "../src/work_order.js";

test("an enabled field-service order exposes photos and the technician follow-up", () => {
  const order = WorkOrderRequest.parse({
    workOrderId: "WO-2048",
    customerId: "C-91",
    photos: [
      { id: "photo-panel", capturedAt: "2026-09-29T08:30:00.000Z", caption: "Panel before repair" },
      { id: "photo-finished", capturedAt: "2026-09-29T09:05:00.000Z", caption: "Repair completed" },
    ],
    dispatchStatus: "completed",
    technicianFollowUp: { required: true, note: "Call customer after the next rain" },
  });

  assert.deepEqual(buildDispatchView(order, true), {
    workOrderId: "WO-2048",
    experience: "infrai-field-service",
    dispatchStatus: "completed",
    photoCount: 2,
    nextAction: "Call customer after the next rain",
  });
  assert.equal(buildDispatchView(order, false).experience, "incumbent");
});
