export type VisitType = "first_time" | "been_a_while" | "regular";

export type ConnectField = "name" | "phone" | "email" | "visitType" | "notes" | "prayerRequest";

export type ConnectFieldErrors = Partial<Record<ConnectField, string>>;

/** Body for POST /api/missio/connect. `website` is the honeypot and is always empty. Email is not collected. */
export interface ConnectSubmitBody {
  name: string;
  phone: string;
  visitType: VisitType;
  wantsHouseChurch: boolean;
  wantsPrayer?: boolean;
  prayerRequest?: string;
  notes?: string;
  website: "";
}

export interface ConnectDraft {
  name: string;
  phone: string;
  visitType: VisitType | "";
  wantsHouseChurch: boolean;
  wantsPrayer: boolean;
  prayerRequest: string;
  notes: string;
}
