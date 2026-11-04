// Fixed native decoding budget for the 2-CPU/4-GiB render role. Do not derive a
// frame cache from host-wide memory on a containerized public worker.
export const renderMediaResources = {
  offthreadVideoCacheSizeInBytes: 128 * 1024 ** 2,
  offthreadVideoThreads: 2,
} as const;
