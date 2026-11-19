import { emailParts } from "../email-parts";

describe("emailParts", () => {
  it("splits before the @, so the address wraps there", () => {
    expect(emailParts("jackery.kilman@gmail.com")).toEqual(["jackery.kilman", "@gmail.com"]);
  });

  it("keeps anything that isn't name@domain whole", () => {
    expect(emailParts("—")).toEqual(["—"]);
    expect(emailParts("@handle")).toEqual(["@handle"]);
  });
});
