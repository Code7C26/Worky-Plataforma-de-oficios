import assert from "node:assert/strict";
import { test } from "node:test";
import { partnerVerificationStatus, requiredPartnerDocuments } from "../src/lib/partner-verification";

test("requires each mandatory type, rather than just counting approved files", () => {
  const required = requiredPartnerDocuments.map((tipo) => ({ tipo, estado: "verified" }));
  assert.equal(partnerVerificationStatus([]), "pending_verification");
  assert.equal(partnerVerificationStatus(required), "verified");
  assert.equal(partnerVerificationStatus([...required.slice(1), { tipo: "matricula", estado: "verified" }]), "pending_verification");
  assert.equal(partnerVerificationStatus([...required, { tipo: "matricula", estado: "pending_verification" }]), "pending_verification");
  assert.equal(partnerVerificationStatus([...required, { tipo: "matricula", estado: "rejected" }]), "rejected");
  assert.equal(partnerVerificationStatus([...required, { tipo: "matricula", estado: "verified" }]), "verified");
});
