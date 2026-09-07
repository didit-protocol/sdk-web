# DiditSDK for Web

A lightweight JavaScript/TypeScript SDK for embedding Didit identity verification in web applications.

## Features

- 🎯 **Simple API** - Singleton pattern with easy-to-use methods
- 🔐 **Flexible Integration** - Use UniLink URL directly or create sessions via backend
- 💸 **Transaction Submission** - Submit monitored transactions (incl. Travel Rule) with a scoped token, automatic device intelligence, and an auto-launched wallet-ownership flow
- 📱 **Responsive** - Works on desktop and mobile browsers
- 🎨 **Customizable** - Configuration options for styling and behavior
- 📦 **Multiple Formats** - ESM, CommonJS, and UMD builds
- 🔷 **TypeScript** - Full type definitions included

## Installation

### NPM/Yarn

```bash
npm install @didit-protocol/sdk-web
# or
yarn add @didit-protocol/sdk-web
```

### CDN (UMD)

```html
<script src="https://unpkg.com/@didit-protocol/sdk-web/dist/didit-sdk.umd.min.js"></script>
```

## Package Version

Inspect the installed SDK version at runtime:

```typescript
import { SDK_VERSION } from '@didit-protocol/sdk-web';

console.log(SDK_VERSION);
```

`SDK_VERSION` is injected from `package.json` during the build. Release maintainers should update the package with `npm version <version> --no-git-tag-version`, then run `npm run test:build-version`. That check validates ESM, CommonJS, UMD, minified UMD, and the emitted TypeScript declaration against both the current version and a simulated future version.

## Quick Start

### ES Modules / TypeScript

```typescript
import { DiditSdk } from '@didit-protocol/sdk-web';

// Set up completion callback
DiditSdk.shared.onComplete = (result) => {
  switch (result.type) {
    case 'completed':
      console.log('Verification completed!');
      console.log('Session ID:', result.session?.sessionId);
      console.log('Status:', result.session?.status);
      break;
    case 'cancelled':
      console.log('User cancelled verification');
      break;
    case 'failed':
      console.error('Verification failed:', result.error?.message);
      break;
  }
};

// Start verification with URL (from your backend or UniLink)
DiditSdk.shared.startVerification({
  url: 'https://verify.didit.me/session/session-token'
});
```

### Script Tag (UMD)

```html
<script src="https://unpkg.com/@didit-protocol/sdk-web/dist/didit-sdk.umd.min.js"></script>
<script>
  const { DiditSdk } = DiditSDK;

  DiditSdk.shared.onComplete = (result) => {
    if (result.type === 'completed') {
      alert('Verification completed: ' + result.session.status);
    }
  };

  function startVerification() {
    DiditSdk.shared.startVerification({
      // You can get this link by clicking on "copy link" in the workflows view
      url: 'https://verify.didit.me/u/WORKFLOW_ID_IN_BASE_64'
    });
  }
</script>

<button onclick="startVerification()">Verify Identity</button>
```

## Integration Methods

There are two ways to integrate the SDK:

### Method 1: UniLink URL (Simplest)

Use your workflow's UniLink URL directly from the Didit Console. No backend required.

```typescript
DiditSdk.shared.startVerification({
  // You can get this link by clicking on "copy link" in the workflows view
  url: 'https://verify.didit.me/u/WORKFLOW_ID_IN_BASE_64'
});
```

Get your UniLink URL from the [Didit Console](https://business.didit.me) → Your Workflow → Copy Link.

**The session_id generated will be sent to you by an event.**
**[Check event reference here](#event-reference)**

### Method 2: Backend Session (Recommended for production)

Your backend creates a session via the Didit API and returns the verification URL. This gives you more control over session creation, user tracking, and security.
Read more about how the create session API works here:
https://docs.didit.me/reference/create-session-verification-sessions

```typescript
// Get the verification URL from your backend
const { url } = await yourBackend.createVerificationSession();

DiditSdk.shared.startVerification({
  url,
  configuration: {
    loggingEnabled: true
  }
});
```


## Configuration

```typescript
interface DiditSdkConfiguration {
  /**
   * Enable SDK logging for debugging
   * @default false
   */
  loggingEnabled?: boolean;

  /**
   * Custom container element to mount the modal
   * @default document.body
   */
  containerElement?: HTMLElement;

  /**
   * Z-index for the modal overlay
   * @default 9999
   */
  zIndex?: number;

  /**
   * Show close button on modal
   * @default true
   */
  showCloseButton?: boolean;

  /**
   * Show exit confirmation dialog when closing
   * @default true
   */
  showExitConfirmation?: boolean;  
  /**
   * Automatically close modal when verification completes
   * @default false
   */
  closeModalOnComplete?: boolean;

  /**
   * Render verification inline instead of modal overlay
   * @default false
   */
  embedded?: boolean;

  /**
   * Container element ID for embedded mode
   * Required when embedded is true
   */
  embeddedContainerId?: string;
}
```

## Modal Sizing

Modal mode uses a maximum width of 500px and a maximum height of 700px. On shorter desktop and landscape viewports, the iframe tracks 90% of the visible viewport so the modal never extends beyond its container. The hosted flow owns the scrollbar inside the iframe, keeping later steps reachable without scrolling the page behind the modal.

Browsers that support dynamic viewport units use `dvh`, while older supported browsers fall back to `vh`. At widths of 540px and below, the modal fills the visible viewport. The close button and exit confirmation stay inside the modal at every size.

## Embedded Mode

Render verification inline instead of a modal overlay. Embedded mode does not apply the modal's 500px by 700px cap; the SDK fills the host element's content box. Give the host an explicit or otherwise resolved height:

```html
<div id="verification-container" style="width: 500px; height: 700px;"></div>
```

```typescript
DiditSdk.shared.startVerification({
  url: 'https://verify.didit.me/u/...',
  configuration: {
    embedded: true,
    embeddedContainerId: 'verification-container'
  }
});
```

If the host element has no resolved height, the embedded iframe also has no usable height. Resize the host element when your layout changes; the SDK continues to fill it automatically.

## Verification Results

The SDK returns three types of results:

### Completed

Verification flow finished (approved, pending, or declined).

```typescript
{
  type: 'completed',
  session: {
    sessionId: 'session-uuid',
    status: 'Approved' | 'Pending' | 'Declined'
  }
}
```

### Cancelled

User closed the verification modal.

```typescript
{
  type: 'cancelled',
  session: {
    sessionId: 'session-uuid',
    status: 'Pending'
  }
}
```

### Failed

An error occurred during verification.

```typescript
{
  type: 'failed',
  error: {
    type: 'sessionExpired' | 'networkError' | 'cameraAccessDenied' | 'unknown',
    message: 'Your verification session has expired.'
  }
}
```

## State Management

You can observe the SDK state for custom UI:

```typescript
DiditSdk.shared.onStateChange = (state, error) => {
  switch (state) {
    case 'idle':
      // Ready to start
      break;
    case 'loading':
      // Loading verification iframe
      showLoadingSpinner();
      break;
    case 'ready':
      // Verification in progress
      hideLoadingSpinner();
      break;
    case 'error':
      // Error occurred
      showError(error);
      break;
  }
};

// Check current state
console.log(DiditSdk.shared.state);

// Check if verification is presented
console.log(DiditSdk.shared.isPresented);
```

## Transaction Submission

Submit [monitored transactions](https://docs.didit.me/transaction-monitoring/sdk-transaction-submission) — including [Travel Rule](https://docs.didit.me/transaction-monitoring/travel-rule) transfers and crypto screening — straight from the browser. Your backend mints a short-lived scoped token with `POST /v3/transactions/sdk-token/`; the SDK does the rest: it binds the subject to the token server-side, attaches device intelligence automatically, and auto-launches the wallet-ownership flow when the transaction requires proof of wallet control.

```typescript
import { DiditSdk, DiditTransactionError } from "@didit-protocol/sdk-web";

try {
  const result = await DiditSdk.shared.submitTransaction({
    transactionToken: sdkToken, // minted by YOUR backend - never ship an API key
    transaction: {
      txnId: "wd-2026-07-07-0042",
      category: "travelRule",
      details: {
        direction: "out",
        amount: "0.25",
        currency: "ETH",
        currencyType: "crypto",
        cryptoParams: { crypto_chain: "ETH" },
      },
      subject: { type: "individual", fullName: "Jane Doe" },
      counterparty: {
        type: "individual",
        fullName: "Ana Diaz",
        paymentMethod: { type: "unhosted_wallet", accountId: "0xBeneficiaryWallet01" },
      },
      travelRule: {
        beneficiaryData: { wallet_address: "0xBeneficiaryWallet01", name: "Ana Diaz" },
      },
      includeCryptoScreening: true,
    },
    autoLaunchAction: true, // default - auto-launches wallet_ownership in the SDK modal
    onActionCompleted: (refreshed) => {
      console.log(refreshed.status, refreshed.travelRuleStatus);
    },
  });

  console.log(result.transactionId, result.status);

  // verification_session actions are NEVER auto-launched - start them yourself:
  if (result.actionRequired?.type === "verification_session") {
    DiditSdk.shared.startVerification({ url: result.actionRequired.url });
  }
} catch (error) {
  if (error instanceof DiditTransactionError) {
    // error.type: "expired_token" | "invalid_token" | "validation" | "network"
    // error.fieldErrors carries per-field details for validation errors
  }
}
```

Key points:

- **`transactionToken`** — scoped to one user (`vendor_data`) at mint time; the subject identity is enforced server-side from it, so a tampered client cannot submit for another user.
- **`autoLaunchAction`** (default `true`) — auto-launches only `wallet_ownership` actions (in the SDK's overlay modal); a `verification_session` action always comes back in `result.actionRequired` for your app to launch with `startVerification`.
- **Device intelligence** — a privacy-safe fingerprint is attached to every submission automatically; IP and user agent are derived server-side.
- **`onActionCompleted`** — receives the refreshed transaction after an auto-launched flow completes or its window closes.

Full guide: [SDK Transaction Submission](https://docs.didit.me/transaction-monitoring/sdk-transaction-submission).

## API Reference

### DiditSdk.shared

The singleton SDK instance.

### Methods

| Method | Description |
|--------|-------------|
| `startVerification(options)` | Start the verification flow |
| `submitTransaction(options)` | Submit a monitored transaction with a scoped token ([guide](https://docs.didit.me/transaction-monitoring/sdk-transaction-submission)) |
| `close()` | Programmatically close the verification modal |
| `destroy()` | Destroy the SDK instance and clean up |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `DiditSdkState` | Current SDK state |
| `configuration` | `DiditSdkConfiguration` | Current configuration |
| `isPresented` | `boolean` | Whether verification modal is open |
| `errorMessage` | `string` | Error message (when in error state) |

### Callbacks

| Callback | Parameters | Description |
|----------|------------|-------------|
| `onComplete` | `(result: VerificationResult)` | Called when verification finishes |
| `onStateChange` | `(state: DiditSdkState, error?: string)` | Called on state changes |
| `onEvent` | `(event: VerificationEvent)` | Called on granular verification events |

## Granular Events

Track verification progress with the `onEvent` callback:

```typescript
DiditSdk.shared.onEvent = (event) => {
  console.log('Event:', event.type, event.data);
};
```

### Event Reference

| Event | Description | Data Payload |
|-------|-------------|--------------|
| `didit:ready` | The page is ready and the sessionId is available | `{ sessionId }` |
| `didit:started` | User started verification | `{ sessionId? }` |
| `didit:step_started` | A verification step began | `{ step, sessionId? }` |
| `didit:step_completed` | A step finished successfully | `{ step, nextStep?, sessionId? }` |
| `didit:step_changed` | Current step changed | `{ step, previousStep?, sessionId? }` |
| `didit:media_started` | Camera/media capture started | `{ step, mediaType }` |
| `didit:media_captured` | Photo/video captured | `{ step, isAuto }` |
| `didit:document_selected` | User selected document type and country | `{ documentType, country }` |
| `didit:verification_submitted` | Data submitted for processing | `{ step, sessionId? }` |
| `didit:code_sent` | OTP code sent | `{ step, channel?, codeSize?, sessionId? }` |
| `didit:code_verified` | OTP code verified | `{ step, sessionId? }` |
| `didit:status_updated` | Session status changed | `{ status, previousStep?, sessionId? }` |
| `didit:completed` | Verification flow completed | `{ sessionId?, status?, country?, documentType? }` |
| `didit:cancelled` | User cancelled verification | `{ sessionId? }` |
| `didit:error` | An error occurred | `{ error, step?, sessionId? }` |
| `didit:close_request` | User requested to close modal | (no data) |

### Step Values

The `step` field can be one of:
- `document_selection` - Document type selection
- `document_front` - Front side of document
- `document_back` - Back side of document
- `face` - Face/liveness verification
- `email` - Email verification
- `phone` - Phone verification
- `poa` - Proof of address
- `questionnaire` - Questionnaire step

### Channel Values

The `channel` field in `code_sent` can be:
- `email` - Code sent via email
- `sms` - Code sent via SMS
- `whatsapp` - Code sent via WhatsApp

### Code Size

The `codeSize` field in `code_sent` indicates the OTP code length (e.g., 4 or 6 digits).

## Browser Support

- Chrome 70+
- Firefox 65+
- Safari 12+
- Edge 79+


## License

Copyright © 2026 Didit. All rights reserved.
