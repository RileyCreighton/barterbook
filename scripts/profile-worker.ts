import data from "../evidence/spike-3-owner-plan.json";
import { verifyTransaction } from "../src/shared/transactions";
import { unb64 } from "../src/shared/crypto";
import type { FrozenPlan } from "../src/shared/types";
export default {
  fetch(request: Request) {
    const n = Math.min(
      1000,
      Math.max(1, Number(new URL(request.url).searchParams.get("n") ?? 1)),
    );
    for (let i = 0; i < n; i++)
      verifyTransaction(unb64(data.wireBase64), data.plan as FrozenPlan);
    return Response.json({ iterations: n, validated: true });
  },
};
