import { act, render } from "@testing-library/react";

import { DiditAuthProvider } from "../context";
import { SignIn, SignUp } from "../SignIn";
import { snapshotOf } from "../store";
import { testClient } from "./test-client";

describe("<SignIn /> and <SignUp />", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("wait for the session, then open the hosted page once with the page's return path", () => {
    window.history.replaceState(null, "", "/sign-in?redirect_url=%2Faccount");
    const { client, store } = testClient({ session: "loading" });
    const { getByText, rerender } = render(
      <DiditAuthProvider client={client}>
        <SignIn fallback={<p>Opening sign-in</p>} />
      </DiditAuthProvider>
    );

    expect(getByText("Opening sign-in")).toBeTruthy();
    expect(client.signIn).not.toHaveBeenCalled();
    act(() => store.set(snapshotOf(null)));
    rerender(
      <DiditAuthProvider client={client}>
        <SignIn fallback={<p>Opening sign-in</p>} />
      </DiditAuthProvider>
    );
    expect(client.signIn).toHaveBeenCalledTimes(1);
    expect(client.signIn).toHaveBeenCalledWith({ redirectUrl: "/account" });
  });

  it("never pass on a return path to another site", () => {
    window.history.replaceState(null, "", "/sign-up?redirect_url=%2F%2Fevil.example");
    const { client } = testClient({ session: null });

    render(
      <DiditAuthProvider client={client}>
        <SignUp />
      </DiditAuthProvider>
    );
    expect(client.signUp).toHaveBeenCalledWith({ redirectUrl: "/" });
  });

  it("prefer the redirectUrl prop", () => {
    const { client } = testClient({ session: null });

    render(
      <DiditAuthProvider client={client}>
        <SignIn redirectUrl="/welcome" />
      </DiditAuthProvider>
    );
    expect(client.signIn).toHaveBeenCalledWith({ redirectUrl: "/welcome" });
  });
});
