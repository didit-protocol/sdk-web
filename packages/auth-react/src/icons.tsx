import { useId } from "react";

import { wordmark } from "./wordmark.js";

const RING =
  "M64.6236 169.933C28.9907 169.933 0 140.911 0 105.24V64.6929C0 29.0219 28.9907 0 64.6236 0C100.256 0 129.247 29.0219 129.247 64.6929V105.24C129.402 122.279 122.805 138.447 110.667 150.707C98.3946 163.103 82.0438 169.933 64.6236 169.933ZM64.6236 15.3042C37.4174 15.3042 15.2878 37.4575 15.2878 64.6929V105.24C15.2878 132.475 37.4174 154.628 64.6236 154.628C77.9335 154.628 90.4253 149.411 99.8054 139.937C109.05 130.598 114.075 118.306 113.959 105.311V64.6994C113.959 37.464 91.8298 15.3106 64.6236 15.3106V15.3042Z";

/** The check in a circle the success notice uses. */
export function CheckCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.75 11.9999L10.58 14.8299L16.25 9.16992"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The same circle with an exclamation mark, for a notice that something failed. */
export function AlertCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7.75V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.995 16H12.004" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The Didit lockup: the brand ring over the wordmark, as in "Powered by Didit". */
export function DiditLockup() {
  const gradient = `didit-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <span className="didit-lockup" role="img" aria-label="Didit">
      <img className="didit-wordmark" src={wordmark} alt="" />
      <svg className="didit-ring" width="10" viewBox="0 0 200 260" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradient} x1="18%" y1="88%" x2="82%" y2="12%">
            <stop offset="0%" stopColor="#8FE0FB" />
            <stop offset="50%" stopColor="#2567FF" />
            <stop offset="100%" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
        <path d={RING} fill={`url(#${gradient})`} fillRule="evenodd" transform="translate(1.125 0) scale(1.53001)" />
      </svg>
    </span>
  );
}
