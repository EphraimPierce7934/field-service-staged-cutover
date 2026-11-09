import { z } from "zod";

export const WorkOrderRequest = z.object({
  workOrderId: z.string().min(1),
  customerId: z.string().min(1),
  photos: z.array(z.object({
    id: z.string().min(1),
    capturedAt: z.string().datetime(),
    caption: z.string().min(1).max(160),
  })).max(12),
  dispatchStatus: z.enum(["unassigned", "dispatched", "on_site", "completed"]),
  technicianFollowUp: z.object({
    required: z.boolean(),
    note: z.string().min(1).max(500).optional(),
  }),
}).superRefine((order, context) => {
  if (order.technicianFollowUp.required && !order.technicianFollowUp.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["technicianFollowUp", "note"],
      message: "A follow-up note is required when follow-up is requested",
    });
  }
});

export type WorkOrder = z.infer<typeof WorkOrderRequest>;
export type Experience = "incumbent" | "infrai-field-service";

export function buildDispatchView(order: WorkOrder, enabled: boolean) {
  const experience: Experience = enabled ? "infrai-field-service" : "incumbent";
  return {
    workOrderId: order.workOrderId,
    experience,
    dispatchStatus: order.dispatchStatus,
    photoCount: enabled ? order.photos.length : 0,
    nextAction: enabled && order.technicianFollowUp.required
      ? order.technicianFollowUp.note
      : null,
  };
}
