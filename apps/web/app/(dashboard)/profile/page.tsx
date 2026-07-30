import { getTaxpayerProfileOrNull } from "@/lib/getOrCreateTaxpayerProfile";
import { ProfileForm, type ProfileInitialValues } from "./ProfileForm";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ProfilePage() {
  const profile = await getTaxpayerProfileOrNull();

  const initial: ProfileInitialValues = profile
    ? {
        isNew: false,
        pan: profile.pan,
        fullName: profile.fullName,
        dateOfBirth: toDateInputValue(profile.dateOfBirth),
        aadhaar: profile.aadhaar ?? undefined,
        addressLine1: profile.addressLine1 ?? undefined,
        addressLine2: profile.addressLine2 ?? undefined,
        city: profile.city ?? undefined,
        state: profile.state ?? undefined,
        pincode: profile.pincode ?? undefined,
        bankAccountNumber: profile.bankAccountNumber ?? undefined,
        bankIfsc: profile.bankIfsc ?? undefined,
        bankName: profile.bankName ?? undefined,
      }
    : {
        isNew: true,
        pan: "",
        fullName: "",
        dateOfBirth: "",
        aadhaar: undefined,
        addressLine1: undefined,
        addressLine2: undefined,
        city: undefined,
        state: undefined,
        pincode: undefined,
        bankAccountNumber: undefined,
        bankIfsc: undefined,
        bankName: undefined,
      };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Your profile</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          PAN, Aadhaar, and bank account number are encrypted at rest and masked below by default — use
          &ldquo;Show / edit&rdquo; to reveal or change them.
        </p>
      </div>
      <ProfileForm initial={initial} />
    </div>
  );
}
