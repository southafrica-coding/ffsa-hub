/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPersonDialog } from "./add-person";
import { MissioApiError, EXISTS_USE_SEARCH_MESSAGE, type MissioClient } from "./api";
import styles from "./shell.module.css";
import type { ContactMatch, CreateMissioPersonInput, MissioPerson } from "./types-shim";

const { validation } = vi.hoisted(() => ({
  validation: { override: null as null | (() => string | null) },
}));

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    validateNewPerson: (fields: { name: string; email: string; phone: string }) =>
      validation.override ? validation.override() : actual.validateNewPerson(fields),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person: MissioPerson = {
  id: "p-new",
  contactId: "c-mina",
  name: "Mina Osei",
  campus: "jhb",
  status: "visitor",
  joinedAt: null,
  currentStage: null,
};

const openMatch: ContactMatch = {
  matchToken: "tok-mina",
  maskedName: "M••• O•••",
  maskedEmail: "m•••@example.com",
  maskedPhone: "••• 4412",
  alreadyInOrg: false,
};

const takenMatch: ContactMatch = {
  matchToken: "tok-sam",
  maskedName: "S•• O••••",
  maskedEmail: "s•••@example.com",
  maskedPhone: "••• 0199",
  alreadyInOrg: true,
  personId: "p-sam",
  name: "Sam Okoye",
};

function client(partial: Partial<MissioClient>): MissioClient {
  return {
    getMe: async () => {
      throw new Error("unused");
    },
    listPeople: async () => ({ rows: [], total: 0 }),
    searchContacts: async () => ({ matches: [] }),
    createPerson: async () => ({ person, linkedExisting: false }),
    updatePerson: async () => {},
    ...partial,
  };
}

function render(node: ReactNode) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const root = createRoot(mount);
  act(() => root.render(node));
  return { host: document.body, root, mount };
}

function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(host: ParentNode, label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("add person", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    validation.override = null;
    while (roots.length) act(() => roots.pop()?.unmount());
    document.body.innerHTML = "";
  });

  it("rejects a name before searching", async () => {
    const searchContacts = vi.fn(async () => ({ matches: [] }));
    const { host, root } = render(
      <AddPersonDialog client={client({ searchContacts })} onClose={() => {}} onCreated={() => {}} />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "Mina Osei");
    await click(host, "Find contact");
    expect(searchContacts).not.toHaveBeenCalled();
    expect(host.textContent).toMatch(/name isn’t accepted/i);
  });

  it("disables linking when the contact is already in Missio", async () => {
    const searchContacts = vi.fn(async () => ({ matches: [takenMatch] }));
    const createPerson = vi.fn();
    const onViewPerson = vi.fn();
    const { host, root } = render(
      <AddPersonDialog
        client={client({ searchContacts, createPerson })}
        onClose={() => {}}
        onCreated={() => {}}
        onViewPerson={onViewPerson}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "sam.okoye@example.com");
    await click(host, "Find contact");
    expect(searchContacts).toHaveBeenCalledWith("sam.okoye@example.com");
    expect(host.textContent).toContain("Email (masked)");
    expect(host.textContent).toContain("Phone (masked)");
    expect(host.textContent).toContain("Name (masked)");
    expect(host.textContent).toContain("s•••@example.com");
    expect(host.textContent).toContain("Sam Okoye");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Use this contact");
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector("[data-testid=already-in-org]")?.textContent).toContain("Already in Missio");
    expect(createPerson).not.toHaveBeenCalled();
    await click(host, "Open their record");
    expect(onViewPerson).toHaveBeenCalledWith("p-sam", "Sam Okoye");
  });

  it("links an existing contact and says so when the route linked one", async () => {
    const createPerson = vi.fn<(input: CreateMissioPersonInput) => Promise<{ person: MissioPerson; linkedExisting: boolean }>>(
      async () => ({ person, linkedExisting: true })
    );
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [openMatch] }),
          createPerson,
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    setValue(host.querySelector("[aria-label='Campus for new person']") as HTMLSelectElement, "jhb");
    await click(document.body, "Use this contact");
    expect(createPerson).toHaveBeenCalledWith({
      matchToken: "tok-mina",
      matchedBy: { email: "mina.osei@example.com" },
      campus: "jhb",
      status: "visitor",
    });
    expect(createPerson.mock.calls[0][0]).not.toHaveProperty("contactId");
    expect(host.querySelector("[data-testid=linked-existing]")?.textContent).toBe("Linked to an existing contact");
  });

  it("steers a create-form exists_use_search 409 back to search with the typed email", async () => {
    const searchContacts = vi
      .fn<(q: string) => Promise<{ matches: ContactMatch[] }>>()
      .mockResolvedValueOnce({ matches: [] })
      .mockResolvedValueOnce({ matches: [openMatch] });
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts,
          createPerson: async () => {
            throw new MissioApiError(409, "RAW 409 TEXT", null, "exists_use_search");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Mina Osei");
    await click(host, "Create person");
    await act(async () => {
      await Promise.resolve();
    });
    const callout = host.querySelector("[data-testid=exists-use-search]");
    expect(callout?.textContent).toBe(EXISTS_USE_SEARCH_MESSAGE);
    expect(callout?.getAttribute("role")).toBe("status");
    expect(callout?.classList.contains(styles.info)).toBe(true);
    expect(host.textContent).not.toContain("RAW 409 TEXT");
    const field = host.querySelector("[aria-label='Email or phone']") as HTMLInputElement;
    expect(field.value).toBe("mina.osei@example.com");
    expect(searchContacts).toHaveBeenLastCalledWith("mina.osei@example.com");
    expect(host.textContent).toContain("Name (masked)");
    expect(host.textContent).toContain("M••• O•••");
  });

  it("keeps a different 409 as Already in Missio and does not steer to search", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [] }),
          createPerson: async () => {
            throw new MissioApiError(409, "Already in Missio", null, "already_in_org");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Mina Osei");
    await click(host, "Create person");
    expect(host.textContent).toContain("Already in Missio");
    expect(host.querySelector("[data-testid=exists-use-search]")).toBeNull();
    expect(host.querySelector("[data-testid=create-person-form]")).not.toBeNull();
  });

  it("does not treat linkedExisting on the create form as a link", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [] }),
          createPerson: async () => ({ person, linkedExisting: true }),
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    await click(host, "Create person");
    expect(host.textContent).toContain("Person added");
    expect(host.querySelector("[data-testid=linked-existing]")).toBeNull();
  });

  it("disables create after a POST 429", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [] }),
          createPerson: async () => {
            throw new MissioApiError(429, "slow down", 15, "rate_limited");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    await click(host, "Create person");
    expect(host.querySelector("[data-testid=submit-rate-limit]")?.textContent).toBe(
      "Too many attempts, try again in 15 seconds"
    );
    const submit = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Create person");
    expect(submit?.hasAttribute("disabled")).toBe(true);
    await click(host, "Back");
    const search = host.querySelector("[aria-label='Email or phone']") as HTMLInputElement;
    const find = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Find contact");
    expect(search.disabled).toBe(false);
    expect(find?.hasAttribute("disabled")).toBe(false);
  });

  it("locks Use this contact on a link 429 without locking search", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [openMatch] }),
          createPerson: async () => {
            throw new MissioApiError(429, "slow down", 15, "rate_limited");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    await click(host, "Use this contact");
    expect(host.querySelector("[data-testid=submit-rate-limit]")?.textContent).toBe(
      "Too many attempts, try again in 15 seconds"
    );
    const use = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Use this contact");
    const find = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Find contact");
    expect(use?.hasAttribute("disabled")).toBe(true);
    expect(find?.hasAttribute("disabled")).toBe(false);
  });

  it("sends the pastor back to search when the match token has expired", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [openMatch] }),
          createPerson: async () => {
            throw new MissioApiError(400, "invalid token", null, "invalid_token");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    await click(document.body, "Use this contact");
    expect(host.querySelector("[data-testid=match-expired]")?.textContent).toBe("That match expired, search again");
    expect(host.querySelector("[aria-label='Email or phone']")).not.toBeNull();
    expect(host.querySelector("[data-testid=create-person-form]")).toBeNull();
  });

  it("disables search after a 429 and says how long to wait", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => {
            throw new MissioApiError(429, "Too many searches, try again in 20 seconds", 20, "rate_limited");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "mina.osei@example.com");
    await click(host, "Find contact");
    expect(host.querySelector("[data-testid=search-rate-limit]")?.textContent).toBe(
      "Too many searches, try again in 20 seconds"
    );
    const again = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Find contact");
    expect(again?.hasAttribute("disabled")).toBe(true);
    expect((host.querySelector("[aria-label='Email or phone']") as HTMLInputElement).disabled).toBe(true);
  });

  it("creates a new person only after no contact matches", async () => {
    const createPerson = vi.fn<(input: CreateMissioPersonInput) => Promise<{ person: MissioPerson; linkedExisting: boolean }>>(
      async () => ({ person, linkedExisting: false })
    );
    const { host, root } = render(
      <AddPersonDialog
        client={client({ searchContacts: async () => ({ matches: [] }), createPerson })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "0825550199");
    await click(host, "Find contact");
    expect(host.textContent).toMatch(/No contact uses that email or phone/);
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Mina Osei");
    const emailInput = host.querySelector("[aria-label=Email]") as HTMLInputElement;
    const phoneInput = host.querySelector("[aria-label=Phone]") as HTMLInputElement;
    expect(emailInput.type).toBe("email");
    expect(emailInput.autocomplete).toBe("email");
    expect(phoneInput.type).toBe("tel");
    expect(phoneInput.inputMode).toBe("tel");
    expect(phoneInput.autocomplete).toBe("tel");
    setValue(emailInput, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label='Status for new person']") as HTMLSelectElement, "active");
    setValue(host.querySelector("[aria-label='Joined date']") as HTMLInputElement, "2026-01-04");
    expect(host.textContent).toContain("4 Jan 2026");
    expect(host.textContent).not.toContain("DD/MM/YYYY");
    await click(host, "Create person");
    expect(createPerson).toHaveBeenCalledWith({
      name: "Mina Osei",
      email: "mina.osei@example.com",
      phone: "0825550199",
      campus: "potch",
      status: "active",
      joinedAt: "2026-01-04",
    });
    expect(createPerson.mock.calls[0][0]).not.toHaveProperty("label");
    expect(host.textContent).toContain("Person added");
  });

  it("searches the phone when the email misses, and links with that phone", async () => {
    const calls: string[] = [];
    let release: (value: { matches: ContactMatch[] }) => void = () => {};
    const phoneMatch: ContactMatch = { ...openMatch, matchToken: "tok-phone" };
    const phoneReady = new Promise<{ matches: ContactMatch[] }>((resolve) => {
      release = resolve;
    });
    const searchContacts = vi.fn(async (q: string) => {
      calls.push(q);
      if (q === "0825550199") return phoneReady;
      return { matches: [] as ContactMatch[] };
    });
    const createPerson = vi.fn(async (input: CreateMissioPersonInput) => {
      if ("name" in input) throw new MissioApiError(409, "RAW", null, "exists_use_search");
      return { person, linkedExisting: true };
    });
    const { host, root } = render(
      <AddPersonDialog client={client({ searchContacts, createPerson })} onClose={() => {}} onCreated={() => {}} />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "0825550199");
    const create = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Create person");
    await act(async () => {
      create?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const find = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Find contact");
    expect(find?.hasAttribute("disabled")).toBe(true);
    expect(calls).toContain("mina.osei@example.com");
    expect(calls).toContain("0825550199");
    await act(async () => {
      release({ matches: [phoneMatch] });
      await phoneReady;
    });
    expect((host.querySelector("[aria-label='Email or phone']") as HTMLInputElement).value).toBe("0825550199");
    expect(host.querySelector("[data-testid=exists-use-search]")?.textContent).toBe(EXISTS_USE_SEARCH_MESSAGE);
    await click(host, "Use this contact");
    expect(createPerson).toHaveBeenLastCalledWith({
      matchToken: "tok-phone",
      matchedBy: { phone: "0825550199" },
      campus: "potch",
      status: "visitor",
    });
  });

  it("does not search the phone when the email already matches", async () => {
    const calls: string[] = [];
    const searchContacts = vi.fn(async (q: string) => {
      calls.push(q);
      if (q === "mina.osei@example.com") return { matches: [openMatch] };
      return { matches: [] as ContactMatch[] };
    });
    const createPerson = vi.fn(async (input: CreateMissioPersonInput) => {
      if ("name" in input) throw new MissioApiError(409, "RAW", null, "exists_use_search");
      return { person, linkedExisting: true };
    });
    const { host, root } = render(
      <AddPersonDialog client={client({ searchContacts, createPerson })} onClose={() => {}} onCreated={() => {}} />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "0825550199");
    await click(host, "Create person");
    expect(calls.filter((q) => q === "0825550199")).toEqual([]);
    expect(calls.filter((q) => q === "mina.osei@example.com")).toEqual(["mina.osei@example.com"]);
    expect((host.querySelector("[aria-label='Email or phone']") as HTMLInputElement).value).toBe("mina.osei@example.com");
    await click(host, "Use this contact");
    expect(createPerson).toHaveBeenLastCalledWith({
      matchToken: "tok-mina",
      matchedBy: { email: "mina.osei@example.com" },
      campus: "potch",
      status: "visitor",
    });
  });

  it("keeps searching when the email only matches people already in Missio", async () => {
    const calls: string[] = [];
    const member: ContactMatch = { ...takenMatch, matchToken: "tok-member" };
    const outsider: ContactMatch = { ...openMatch, matchToken: "tok-outsider" };
    const searchContacts = vi.fn(async (q: string) => {
      calls.push(q);
      if (q === "mina.osei@example.com") return { matches: [member] };
      if (q === "0825550199") return { matches: [outsider] };
      return { matches: [] as ContactMatch[] };
    });
    const createPerson = vi.fn(async (input: CreateMissioPersonInput) => {
      if ("name" in input) throw new MissioApiError(409, "RAW", null, "exists_use_search");
      return { person, linkedExisting: true };
    });
    const { host, root } = render(
      <AddPersonDialog client={client({ searchContacts, createPerson })} onClose={() => {}} onCreated={() => {}} />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "0825550199");
    await click(host, "Create person");
    expect(calls).toContain("mina.osei@example.com");
    expect(calls).toContain("0825550199");
    expect((host.querySelector("[aria-label='Email or phone']") as HTMLInputElement).value).toBe("0825550199");
    expect(host.querySelector("[data-testid=exists-use-search]")?.textContent).toBe(EXISTS_USE_SEARCH_MESSAGE);
    await click(host, "Use this contact");
    expect(createPerson).toHaveBeenLastCalledWith({
      matchToken: "tok-outsider",
      matchedBy: { phone: "0825550199" },
      campus: "potch",
      status: "visitor",
    });
  });

  it("hides Create when both identifiers miss, and shows it again after an edit", async () => {
    const searchContacts = vi.fn(async () => ({ matches: [] as ContactMatch[] }));
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts,
          createPerson: async () => {
            throw new MissioApiError(409, "RAW", null, "exists_use_search");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "0825550199");
    await click(host, "Create person");
    expect(host.querySelector("[data-testid=existing-not-found]")?.textContent).toBe(
      "We couldn't find the existing contact. Check the email and phone, or ask the FFSA office.",
    );
    expect(host.querySelector("[data-testid=exists-use-search]")).toBeNull();
    expect(host.textContent).not.toContain("Create new person");
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "other.person@example.com");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Create new person")).toBe(true);
  });

  it("uses the not-found copy when neither identifier can be searched", async () => {
    validation.override = () => null;
    const searchContacts = vi.fn(async () => ({ matches: [] as ContactMatch[] }));
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts,
          createPerson: async () => {
            throw new MissioApiError(409, "RAW", null, "exists_use_search");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "not-an-email");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "12");
    const callsBefore = searchContacts.mock.calls.length;
    const form = host.querySelector("[data-testid=create-person-form]") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(searchContacts.mock.calls.length).toBe(callsBefore);
    expect(host.querySelector("[data-testid=existing-not-found]")?.textContent).toBe(
      "We couldn't find the existing contact. Check the email and phone, or ask the FFSA office.",
    );
    expect(host.textContent).not.toContain("pick Use this contact");
    expect(host.textContent).not.toContain("Create new person");
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "0825550199");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.trim() === "Create new person")).toBe(true);
  });

  it("does not search again when a follow-up search is rate limited", async () => {
    const calls: string[] = [];
    const searchContacts = vi.fn(async (q: string) => {
      calls.push(q);
      if (q === "mina.osei@example.com") throw new MissioApiError(429, "slow", 30, "rate_limited");
      return { matches: [] as ContactMatch[] };
    });
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts,
          createPerson: async () => {
            throw new MissioApiError(409, "RAW", null, "exists_use_search");
          },
        })}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "new.person@example.com");
    await click(host, "Find contact");
    await click(host, "Create new person");
    setValue(host.querySelector("[aria-label=Name]") as HTMLInputElement, "Ada Mokoena");
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label=Phone]") as HTMLInputElement, "0825550199");
    await click(host, "Create person");
    expect(calls.filter((q) => q === "0825550199")).toEqual([]);
    expect(host.querySelector("[data-testid=search-rate-limit]")?.textContent).toBe(
      "Too many searches, try again in 30 seconds",
    );
    const find = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Find contact");
    expect(find?.hasAttribute("disabled")).toBe(true);
  });
});
