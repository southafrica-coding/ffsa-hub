import type { ProfileFields } from "./api";
import { meStrings } from "./strings";

const MAX_NAME = 80;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export type ProfileErrors = Partial<Record<keyof ProfileFields, string>>;

/** Client-side checks only, for quick feedback; the server validates again. */
export function validateProfile(f: ProfileFields): ProfileErrors {
  const e = meStrings.edit.errors;
  const errors: ProfileErrors = {};
  const first = f.firstName.trim();
  const last = f.lastName.trim();
  const phone = f.phone.trim();
  if (!first) errors.firstName = e.firstNameRequired;
  else if (first.length > MAX_NAME) errors.firstName = e.tooLong(MAX_NAME);
  if (last.length > MAX_NAME) errors.lastName = e.tooLong(MAX_NAME);
  if (phone && !PHONE.test(phone)) errors.phone = e.phoneInvalid;
  return errors;
}

export function hasErrors(errors: ProfileErrors) {
  return Object.keys(errors).length > 0;
}
