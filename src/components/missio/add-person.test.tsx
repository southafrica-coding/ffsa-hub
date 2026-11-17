/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddPersonDialog } from "./add-person";
import { MissioApiError, type MissioClient } from "./api";
import type { ContactMatch, CreateMissioPersonInput, MissioPerson } from "./types-shim";

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
  contactId: "c-mina",
  name: "Mina Osei",
  maskedEmail: "m•••@example.com",
  maskedPhone: "••• 4412",
  alreadyInOrg: false,
};

const takenMatch: ContactMatch = {
  ...openMatch,
  contactId: "c-taken",
  name: "Sam Okoye",
  alreadyInOrg: true,
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
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
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
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
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
    const { host, root } = render(
      <AddPersonDialog client={client({ searchContacts, createPerson })} onClose={() => {}} onCreated={() => {}} />
    );
    roots.push(root);
    hosts.push(host);
    setValue(host.querySelector("[aria-label='Email or phone']") as HTMLInputElement, "sam.okoye@example.com");
    await click(host, "Find contact");
    expect(searchContacts).toHaveBeenCalledWith("sam.okoye@example.com");
    expect(host.textContent).toContain("Email (masked)");
    expect(host.textContent).toContain("Phone (masked)");
    expect(host.textContent).toContain("m•••@example.com");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Use this contact");
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector("[data-testid=already-in-org]")?.textContent).toBe("Already in Missio");
    expect(createPerson).not.toHaveBeenCalled();
  });

  it("links an existing contact and says so when the route linked one", async () => {
    const createPerson = vi.fn(async () => ({ person, linkedExisting: true }));
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
      contactId: "c-mina",
      matchedBy: { email: "mina.osei@example.com" },
      campus: "jhb",
      status: "visitor",
    });
    expect(host.querySelector("[data-testid=linked-existing]")?.textContent).toBe("Linked to an existing contact");
  });

  it("shows Already in Missio when create returns 409", async () => {
    const { host, root } = render(
      <AddPersonDialog
        client={client({
          searchContacts: async () => ({ matches: [openMatch] }),
          createPerson: async () => {
            throw new MissioApiError(409, "Already in Missio");
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
    expect(host.querySelector("[data-testid=create-conflict]")?.textContent).toBe("Already in Missio");
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
    setValue(host.querySelector("[aria-label=Email]") as HTMLInputElement, "mina.osei@example.com");
    setValue(host.querySelector("[aria-label='Status for new person']") as HTMLSelectElement, "active");
    setValue(host.querySelector("[aria-label='Joined date']") as HTMLInputElement, "2026-01-04");
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
});
