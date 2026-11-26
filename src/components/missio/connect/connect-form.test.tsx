/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectSubmitError } from "./client";
import { ConnectForm } from "./connect-form";
import type { ConnectSubmitBody } from "./types";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";

const css = readFileSync(path.join(process.cwd(), "src/components/missio/connect/connect.module.css"), "utf8");

/** Name and phone, a Send that stops on the missing visit type, then the visit type. */
async function fill(form: HTMLFormElement) {
  act(() => {
    setValue(form.querySelector("input[name=name]") as HTMLInputElement, "Lerato Mokoena");
    setValue(form.querySelector("input[name=phone]") as HTMLInputElement, "0825550142");
  });
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
  act(() => {
    (form.querySelector("input[value=first_time]") as HTMLInputElement).click();
  });
}

describe("connect card form", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => cleanup(roots, hosts));

  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("hides the honeypot without display:none and always posts it as an empty string", async () => {
    const honeypot = css.match(/\.honeypot\s*\{[^}]+\}/)?.[0] ?? "";
    expect(honeypot).toMatch(/position:\s*absolute/);
    expect(honeypot).not.toMatch(/display:\s*none/);
    const page = readFileSync(path.join(process.cwd(), "src/app/connect/missio/page.tsx"), "utf8");
    expect(page).toMatch(/index:\s*false/);

    const sent: { current: ConnectSubmitBody | null } = { current: null };
    const host = mount(
      <ConnectForm
        client={{
          submit: async (body) => {
            sent.current = body;
            return { ok: true };
          },
        }}
      />
    );
    const form = host.querySelector("form") as HTMLFormElement;
    const trap = form.querySelector("[data-testid=connect-honeypot]") as HTMLInputElement;
    expect(trap.getAttribute("name")).toBe("website");
    expect(trap.getAttribute("tabindex")).toBe("-1");
    expect(trap.getAttribute("autocomplete")).toBe("off");
    expect(trap.getAttribute("aria-hidden")).toBe("true");
    expect(form.querySelector("input[name=email]")).toBeNull();
    expect(form.textContent).toContain("So we can WhatsApp you. Nothing else.");
    setValue(trap, "https://spam.example");
    await fill(form);
    expect(form.querySelector("[role=radiogroup] label")?.querySelector("input")).toBeTruthy();
    expect(form.textContent).toContain("Anything we can pray about?");
    act(() => (form.querySelector("input[name=wantsHouseChurch][value=yes]") as HTMLInputElement).click());
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    await settle();
    expect(sent.current?.website).toBe("");
    expect(sent.current?.name).toBe("Lerato Mokoena");
    expect(sent.current?.wantsHouseChurch).toBe(true);
    expect(sent.current?.wantsPrayer).toBe(false);
    const thanks = host.querySelector("[data-connect=thanks]") as HTMLElement;
    expect(thanks.textContent).toContain("Thank you.");
    expect(thanks.textContent).toContain("we’ll help you find a house church near you");
    expect(thanks.textContent).not.toContain("Lerato");
    expect(thanks.textContent).not.toContain("082");
  });

  it("shows client validation before it sends", async () => {
    let called = false;
    const host = mount(
      <ConnectForm
        client={{
          submit: async () => {
            called = true;
            return { ok: true };
          },
        }}
      />
    );
    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(called).toBe(false);
    expect(host.textContent).toContain("Enter your name.");
    expect(host.textContent).toContain("Enter a phone number.");
    // One page: the whole card is there from the start, with no stepper.
    expect(form.querySelector("input[name=visitType]")).toBeTruthy();
    expect(host.textContent).not.toContain("Next");
    expect(host.querySelector("[data-testid=connect-banner]")?.textContent).toContain("to fix before sending");

    act(() => {
      setValue(form.querySelector("input[name=name]") as HTMLInputElement, "Naledi Mokoena");
      setValue(form.querySelector("input[name=phone]") as HTMLInputElement, "082 555 01");
    });
    await act(async () => {
      form.requestSubmit();
    });
    expect(host.textContent).toContain("That’s 8 digits. A South African cellphone number has 10.");

    act(() => setValue(form.querySelector("input[name=phone]") as HTMLInputElement, "082 555 0142"));
    await act(async () => {
      form.requestSubmit();
    });
    expect(called).toBe(false);
    expect(host.textContent).not.toContain("That’s 8 digits.");
    expect(host.textContent).toContain("Choose one.");
  });

  it("shows field errors from a 400 and friendly copy for 429 and 500", async () => {
    const cases: Array<{ error: ConnectSubmitError; text: string; hidden: string }> = [
      {
        error: new ConnectSubmitError(400, "invalid_input", null, { phone: "Use a mobile number." }),
        text: "Use a mobile number.",
        hidden: "RAW SERVER TEXT",
      },
      {
        error: new ConnectSubmitError(429, "rate_limited", 30, {}),
        text: "Please wait 30 seconds, then try again.",
        hidden: "RAW SERVER TEXT",
      },
      {
        error: new ConnectSubmitError(500, "server_error", null, {}),
        text: "That didn’t go through. Please try again.",
        hidden: "database exploded",
      },
    ];

    for (const item of cases) {
      const host = mount(
        <ConnectForm
          client={{
            submit: async () => {
              throw item.error;
            },
          }}
        />
      );
      const form = host.querySelector("form") as HTMLFormElement;
      await fill(form);
      await act(async () => {
        form.requestSubmit();
        await Promise.resolve();
      });
      await settle();
      expect(host.textContent).toContain(item.text);
      expect(host.textContent).not.toContain(item.hidden);
      expect(host.querySelector("button[type=submit]")?.hasAttribute("disabled")).toBe(false);
      act(() => {
        roots.pop()?.unmount();
        hosts.pop()?.remove();
      });
    }
  });

  it("shows the consent line above Send", async () => {
    const host = mount(<ConnectForm client={{ submit: async () => ({ ok: true }) }} />);
    await fill(host.querySelector("form") as HTMLFormElement);
    const consent = host.querySelector("[data-testid=connect-consent]");
    expect(consent?.textContent).toContain("you can ask us to remove them anytime");
    expect(consent?.querySelector("a")?.getAttribute("href")).toBe("/legal/consent");
  });
});
