import { api } from "@/lib/api";
import { createJobInput, createServiceJob, listJobs, listJobsQuery } from "@/lib/services/service/intake";

export const GET = api({ query: listJobsQuery }, ({ actor, query }) => listJobs(actor, query));
export const POST = api({ body: createJobInput }, ({ actor, body }) => createServiceJob(actor, body));
