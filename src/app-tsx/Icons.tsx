export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 2v4M8 2v4m13 8v-2c0-3.771 0-5.657-1.172-6.828S16.771 4 13 4h-2C7.229 4 5.343 4 4.172 5.172S3 8.229 3 12v2c0 3.771 0 5.657 1.172 6.828S7.229 22 11 22h2M3 10h18m-3.5 5v7m3.5-3.5h-7" />
    </svg>
  );
}

export function UploadIcon({
  className,
  size = 24,
  strokeWidth = 2,
}: {
  className?: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      color="currentColor"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M14 21.5h-4c-3.288 0-4.931 0-6.038-.908a4 4 0 0 1-.554-.554C2.5 18.93 2.5 17.288 2.5 14c0-3.287 0-4.931.908-6.038a4 4 0 0 1 .554-.554C5.07 6.5 6.712 6.5 10 6.5h4c3.287 0 4.931 0 6.038.908q.304.25.554.554c.908 1.107.908 2.75.908 6.038s0 4.931-.908 6.038a4 4 0 0 1-.554.554c-1.107.908-2.75.908-6.038.908" />
      <path d="M2.5 14.5v-4c0-3.771 0-5.657 1.172-6.828S6.729 2.5 10.5 2.5h3c3.771 0 5.657 0 6.828 1.172S21.5 6.729 21.5 10.5v4" />
      <path d="M15 13.5s-2.21-3-3-3-3 3-3 3m3-2.5v6.5" />
    </svg>
  );
}

export function AddMangaIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 .83.18 2 2 0 0 0 .83-.18l8.58-3.9a1 1 0 0 0 0-1.831zM16 17h6m-3-3v6M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 .825.178M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l2.116-.962" />
    </svg>
  );
}
