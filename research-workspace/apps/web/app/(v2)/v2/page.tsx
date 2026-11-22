import { redirect } from "next/navigation";
import { V2 } from "@/lib/v2/routes";

/** The new UI's entry point opens Home, as the design does. */
export default function V2Index() {
  redirect(`${V2}/home`);
}
