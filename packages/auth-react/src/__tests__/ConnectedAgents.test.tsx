import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ConnectedAgents } from "../ConnectedAgents";
import { DiditAuthProvider } from "../context";
import type { Appearance } from "../types";
import { grants, scopeLabels, session, testClient } from "./test-client";

function renderAgents(
  client: ReturnType<typeof testClient>["client"],
  options: { locale?: string; appearance?: Appearance; applicationName?: string; labels?: Record<string, string> } = {}
) {
  return render(
    <DiditAuthProvider client={client} locale={options.locale ?? "en"} appearance={options.appearance}>
      <ConnectedAgents applicationName={options.applicationName} scopeLabels={options.labels} />
    </DiditAuthProvider>
  );
}

async function card() {
  const region = await screen.findByRole("region", { name: "Connected agents" });

  await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("false"));
  return region;
}

describe("<ConnectedAgents />", () => {
  it("lists the agents that can act now, in the board's words", async () => {
    const { client } = testClient({
      session,
      grants: [
        ...grants,
        { ...grants[0], id: "revoked", agentName: "Old", revokedAt: "2026-01-01T00:00:00Z" },
        { ...grants[0], id: "expired", agentName: "Gone", expiresAt: "2020-01-01T00:00:00Z" }
      ]
    });

    renderAgents(client, { applicationName: "Example app", labels: scopeLabels });
    const region = await card();
    const rows = within(region).getAllByRole("listitem");

    expect(within(region).getByText("AI agents you allowed to act for you in Example app.")).toBeTruthy();
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe(
      "AAgent OneSees your balance and payouts, changes your settings, and requests payouts (it asks you each time).Ends Oct 4Revoke"
    );
    expect(rows[1].textContent).toBe("AAgent TwoSees your payouts. Read only.Ends Oct 19Revoke");
    expect(within(region).getByRole("img", { name: "Didit" })).toBeTruthy();
    expect(region.textContent).toContain("Powered by");
  });

  it("revokes an agent, keeps it visible as revoked and says what happened", async () => {
    const { client } = testClient({ session, grants });

    renderAgents(client, { labels: scopeLabels });
    const region = await card();

    fireEvent.click(within(region).getByRole("button", { name: "Revoke: Agent One" }));
    await within(region).findByText("Agent One's session ended everywhere. It can't act for you until you approve it again.");
    const nova = within(region).getAllByRole("listitem")[0];

    expect(client.revokeAgent).toHaveBeenCalledWith(grants[0].id);
    expect(nova.className).toContain("is-gone");
    expect(within(nova).getByText("Revoked just now")).toBeTruthy();
    expect(within(nova).getByText("Revoked").className).toBe("didit-status");
    expect(within(nova).queryByRole("button")).toBeNull();
    expect(within(region).getByRole("button", { name: "Revoke: Agent Two" })).toBeTruthy();
  });

  it("keeps the agent and says so when revoking fails", async () => {
    const { client } = testClient({ session, grants, revokeError: true });

    renderAgents(client);
    const region = await card();

    fireEvent.click(within(region).getByRole("button", { name: "Revoke: Agent Two" }));
    const notice = await within(region).findByText("We could not revoke Agent Two. Try again.");

    expect(notice.className).toContain("is-error");
    expect(within(region).getByRole("button", { name: "Revoke: Agent Two" })).toBeTruthy();
  });

  it("disables every Revoke button while one revocation is in flight", async () => {
    let finish: () => void = () => undefined;
    const { client } = testClient({ session, grants });

    client.revokeAgent.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    renderAgents(client);
    const region = await card();

    fireEvent.click(within(region).getByRole("button", { name: "Revoke: Agent One" }));
    within(region)
      .getAllByRole("button")
      .forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true));
    await act(async () => finish());
  });

  it("shows raw scope names when no labels are given, and the generic subtitle", async () => {
    const { client } = testClient({ session, grants: [grants[1]] });

    renderAgents(client);
    const region = await card();

    expect(within(region).getByText("payouts:read.")).toBeTruthy();
    expect(within(region).getByText("AI agents you allowed to act for you.")).toBeTruthy();
  });

  it("says when no agent can act, and when the list cannot load", async () => {
    const empty = testClient({ session, grants: [] });
    const { unmount } = renderAgents(empty.client);

    expect(within(await card()).getByText("No AI agent can act for you right now.")).toBeTruthy();
    unmount();
    renderAgents(testClient({ session, listError: true }).client);
    expect((await screen.findByRole("alert")).textContent).toBe("We could not load your connected agents. Try again later.");
  });

  it("speaks the person's language", async () => {
    const { client } = testClient({ session, grants });

    renderAgents(client, { locale: "es", applicationName: "Example app" });
    const region = await screen.findByRole("region", { name: "Agentes conectados" });

    await within(region).findByText("Termina el 4 oct");
    fireEvent.click(within(region).getByRole("button", { name: "Revocar: Agent One" }));
    await within(region).findByText("La sesión de Agent One terminó en todas partes. No puede actuar por ti hasta que vuelvas a aprobarlo.");
    expect(region.textContent).toContain("Con la tecnología de");
  });

  it("carries the theme and brand from the appearance", async () => {
    const { client } = testClient({ session, grants });

    renderAgents(client, { appearance: { theme: "dark", brandColor: "#6B3CF6", fontFamily: "Inter" } });
    const region = await card();

    expect(region.getAttribute("data-didit-theme")).toBe("dark");
    expect(region.style.getPropertyValue("--didit-auth-brand")).toBe("#6B3CF6");
    expect(region.style.getPropertyValue("--didit-auth-font")).toBe("Inter");
  });

  it("renders nothing and loads nothing for a signed-out visitor", () => {
    const { client } = testClient({ session: null, grants });
    const { container } = renderAgents(client);

    expect(container.querySelector(".didit-ca")).toBeNull();
    expect(client.listAgents).not.toHaveBeenCalled();
  });
  it("uses only the publisher and activity labels supplied by the application", async () => {
    const { client } = testClient({ session, grants });
    render(<DiditAuthProvider client={client}><ConnectedAgents agentDetails={{
      [grants[0].agentId]: { publisherLabel: "by Example publisher", activityLabel: "Checked a balance" }
    }} /></DiditAuthProvider>);
    const region = await card();
    expect(within(region).getByText("by Example publisher")).toBeTruthy();
    expect(within(region).getByText("Checked a balance · Ends Oct 4")).toBeTruthy();
    expect(within(region).getAllByText(/by Example publisher/)).toHaveLength(1);
  });

});
