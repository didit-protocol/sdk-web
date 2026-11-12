import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DiditAuthProvider } from "../context";
import { UserButton, initialsOf } from "../UserButton";
import { session, testClient } from "./test-client";

describe("<UserButton />", () => {
  it("opens a menu with the person's email and signs out from it", async () => {
    const { client } = testClient({ session });

    render(
      <DiditAuthProvider client={client} locale="en">
        <UserButton afterSignOutUrl="/goodbye" />
      </DiditAuthProvider>
    );
    const trigger = screen.getByRole("button", { name: "Account" });

    expect(trigger.textContent).toBe("MO");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu").textContent).toContain("maria.oliveira@example.com");
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });

    expect(document.activeElement).toBe(signOut);
    fireEvent.click(signOut);
    expect(client.signOut).toHaveBeenCalledWith({ redirectUrl: "/goodbye" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on Escape and on a click outside, returning focus to the avatar", () => {
    const { client } = testClient({ session });

    render(
      <DiditAuthProvider client={client} locale="de">
        <UserButton />
        <p>outside</p>
      </DiditAuthProvider>
    );
    const trigger = screen.getByRole("button", { name: "Konto" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Abmelden" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders nothing when signed out", () => {
    const { client } = testClient({ session: null });
    const { container } = render(
      <DiditAuthProvider client={client}>
        <UserButton />
      </DiditAuthProvider>
    );

    expect(container.querySelector(".didit-ub")).toBeNull();
  });

  it.each([
    ["maria.oliveira@example.com", null, "MO"],
    ["alex@example.com", null, "AL"],
    [null, "+34600111222", "22"]
  ])("makes initials from %p / %p", (email, phone, expected) => {
    expect(initialsOf({ ...session.user, email, phone })).toBe(expected);
  });
});

it("keeps the menu open with a retryable sign-out error", async () => {
  const { client } = testClient({ session });

  client.signOut.mockRejectedValue(new Error("offline"));
  render(<DiditAuthProvider client={client} locale="en"><UserButton /></DiditAuthProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await screen.findByRole("alert");
  expect((screen.getByRole("menuitem", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
});
