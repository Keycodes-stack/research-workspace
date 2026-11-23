import { notFound } from "next/navigation";

/** Any other /v2 address shows the design's not-found page (in the shell) instead of Next's plain 404. */
export default function Missing() {
  notFound();
}
