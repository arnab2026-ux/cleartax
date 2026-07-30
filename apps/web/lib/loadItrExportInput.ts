/**
 * DB-touching convenience wrapper around the pure mapping layer in
 * `lib/mapping/toItrSchemaInput.ts` — mirrors `lib/loadFullIncomeInput.ts`'s
 * relationship to `toTaxEngineInput.ts` exactly (Phase 5's established
 * pattern). Rebuilds a `FullTaxLiabilityResult` fresh from a
 * `TaxComputation` row's frozen `inputSnapshotJson` (per that model's own
 * doc comment: "specifically so Phase 6 has a reproducible source to build
 * from") rather than trying to reconstruct one from the flattened
 * `TaxComputation` columns, which lost structure (e.g. no per-transaction
 * capital-gains breakdown survives in the columns alone).
 */
import { computeFullTaxLiability, getAgeCategory, type FullIncomeInput, type Regime } from "@cleartax/tax-engine";
import { CURRENT_ASSESSMENT_YEAR } from "./assessmentYear";
import { prisma } from "./db";
import { decimalToNumber } from "./mapping/toTaxEngineInput";
import { buildItrExportInput, checkItrProfileCompleteness, type ItrProfileCompletenessResult } from "./mapping/toItrSchemaInput";
import type { ItrExportInput } from "@cleartax/itr-schema";

interface InputSnapshot {
  fullIncomeInput: FullIncomeInput;
  regime: Regime;
  age: number;
}

/** Defensive runtime narrowing of `TaxComputation.inputSnapshotJson` (a Prisma `JsonValue` at runtime) — this app's own `computeAndSaveTaxComputation` action is the only writer, but nothing statically guarantees its shape survives a round trip through Postgres `jsonb`, so this is checked rather than blindly cast. */
function parseInputSnapshot(raw: unknown, taxComputationId: string): InputSnapshot {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("fullIncomeInput" in raw) ||
    !("regime" in raw) ||
    !("age" in raw) ||
    typeof (raw as { regime: unknown }).regime !== "string" ||
    typeof (raw as { age: unknown }).age !== "number"
  ) {
    throw new Error(`TaxComputation ${taxComputationId} has a malformed inputSnapshotJson — cannot rebuild its tax computation.`);
  }
  const regime = (raw as { regime: string }).regime;
  if (regime !== "old" && regime !== "new") {
    throw new Error(`TaxComputation ${taxComputationId} has an invalid regime "${regime}" in inputSnapshotJson.`);
  }
  return raw as InputSnapshot;
}

/** Returns `{ complete: false, ... }` (never throws) when the profile is missing a field the ITR JSON schema needs — callers should check this before calling `loadItrExportInputForComputation`, which throws in that situation. */
export async function checkItrProfileCompletenessForTaxpayer(taxpayerProfileId: string): Promise<ItrProfileCompletenessResult> {
  const profile = await prisma.taxpayerProfile.findUniqueOrThrow({ where: { id: taxpayerProfileId } });
  return checkItrProfileCompleteness(profile);
}

/** Rebuilds the full `ItrExportInput` for a specific, already-saved `TaxComputation` row. */
export async function loadItrExportInputForComputation(taxComputationId: string): Promise<ItrExportInput> {
  const computationRow = await prisma.taxComputation.findUniqueOrThrow({ where: { id: taxComputationId } });
  const [profile, otherSourceIncomes] = await Promise.all([
    prisma.taxpayerProfile.findUniqueOrThrow({ where: { id: computationRow.taxpayerProfileId } }),
    prisma.otherSourceIncome.findMany({
      where: { taxpayerProfileId: computationRow.taxpayerProfileId, assessmentYear: computationRow.assessmentYear },
    }),
  ]);

  const snapshot = parseInputSnapshot(computationRow.inputSnapshotJson, taxComputationId);
  const computation = computeFullTaxLiability(snapshot.fullIncomeInput, snapshot.regime, snapshot.age);
  const ageCategory = getAgeCategory(snapshot.age);

  return buildItrExportInput({
    assessmentYear: computationRow.assessmentYear ?? CURRENT_ASSESSMENT_YEAR,
    profile,
    regime: snapshot.regime,
    age: ageCategory,
    fullIncomeInput: snapshot.fullIncomeInput,
    computation,
    tdsCredit: decimalToNumber(computationRow.tdsCredit),
    otherSourceIncomes: otherSourceIncomes.map((o) => ({ sourceType: o.sourceType, amount: decimalToNumber(o.amount) })),
  });
}
