import { z } from "zod";
import { money, optionalText } from "./shared";

export const OTHER_SOURCE_TYPES = [
  "SAVINGS_INTEREST",
  "FIXED_DEPOSIT_INTEREST",
  "RECURRING_DEPOSIT_INTEREST",
  "DIVIDEND",
  "FAMILY_PENSION",
  "LOTTERY_OR_GAME_WINNINGS",
  "GIFT",
  "OTHER",
] as const;

export const otherSourceIncomeSchema = z.object({
  sourceType: z.enum(OTHER_SOURCE_TYPES),
  description: optionalText(300, "Description"),
  amount: money("Amount"),
  tdsDeducted: money("TDS deducted"),
});

export type OtherSourceIncomeFormValues = z.infer<typeof otherSourceIncomeSchema>;
