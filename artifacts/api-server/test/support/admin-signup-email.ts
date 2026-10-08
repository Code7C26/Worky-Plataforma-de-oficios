export const deliveries: { to: string; text: string }[] = [];
export let rejectDelivery = false;
export function resetEmail() { deliveries.length = 0; rejectDelivery = false; }
export function failEmail() { rejectDelivery = true; }
export async function sendWorkyEmail(message: { to: string; text: string }) {
  if (rejectDelivery) throw new Error("injected isolated email failure");
  deliveries.push(message);
}
