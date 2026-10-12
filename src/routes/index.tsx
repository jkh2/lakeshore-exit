import { createFileRoute } from "@tanstack/react-router";
import { LakeshoreExit } from "@/components/lakeshore-exit";

export const Route = createFileRoute("/")({ component: LakeshoreExit });
