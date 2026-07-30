import { z } from "zod";
import { money, optionalText } from "./shared";

export const HOUSE_PROPERTY_TYPES = ["SELF_OCCUPIED", "LET_OUT"] as const;

export const housePropertySchema = z.object({
  propertyType: z.enum(HOUSE_PROPERTY_TYPES),
  address: optionalText(300, "Address"),
  annualLetableValue: money("Annual rent received"),
  municipalTaxesPaid: money("Municipal taxes paid"),
  homeLoanInterest: money("Home loan interest"),
});

export type HousePropertyFormValues = z.infer<typeof housePropertySchema>;
