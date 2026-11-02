// Writes the judge's seccomp filter: a small BPF program the kernel runs on
// every system call a sandboxed process makes (seccomp(2)). bubblewrap
// installs it in each sandbox from a file descriptor (--seccomp FD).
// Step 6 of docs/plans/sandboxing.md.
//
// Built at server startup by judge/sandbox.js (g++ ... -lseccomp, which
// needs libseccomp-dev; scripts/sandbox-deps.sh installs it), and run as:
//
//   gen [--pfc] OUTPUT SYSCALL...
//
// It refuses each named system call with EPERM ("Operation not permitted")
// and allows everything else: a denylist (decision D4). Names this
// processor architecture doesn't have are skipped and listed on stderr.
// Two calls get special rules:
// - clone3 fails with ENOSYS ("not implemented"). Its flags are in memory,
//   where a filter can't look, so the C library is made to fall back to
//   clone, whose flags are a plain argument. Docker's default profile does
//   the same.
// - clone with any namespace flag (CLONE_NEWUSER, CLONE_NEWNS, ...) fails
//   with EPERM; ordinary threads and fork() set none of them.
//
// With --pfc it writes libseccomp's "pseudo filter code" instead: the same
// filter as readable text, for checking what the kernel will enforce.
//
// System calls made with another architecture's numbers (for example 32-bit
// x86 code on x86-64) are refused by libseccomp's default for foreign
// architectures (SCMP_FLTATR_ACT_BADARCH, kill), since only this machine's
// own architecture is added to the filter.

#include <seccomp.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <sched.h>
#include <unistd.h>

static int fail(const char *what, int rc) {
  std::fprintf(stderr, "gen: %s: %s\n", what, std::strerror(-rc));
  return 1;
}

int main(int argc, char **argv) {
  int first = 1;
  bool pfc = false;
  if (argc > 1 && std::strcmp(argv[1], "--pfc") == 0) {
    pfc = true;
    first = 2;
  }
  if (argc - first < 1) {
    std::fprintf(stderr, "usage: gen [--pfc] OUTPUT SYSCALL...\n");
    return 2;
  }
  const char *output = argv[first];

  scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
  if (ctx == nullptr) {
    std::fprintf(stderr, "gen: seccomp_init failed\n");
    return 1;
  }

  for (int i = first + 1; i < argc; i++) {
    int nr = seccomp_syscall_resolve_name(argv[i]);
    if (nr == __NR_SCMP_ERROR) {
      std::fprintf(stderr, "gen: %s: no such system call on this architecture, skipped\n", argv[i]);
      continue;
    }
    int rc = seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), nr, 0);
    if (rc < 0) return fail(argv[i], rc);
  }

  int clone3 = seccomp_syscall_resolve_name("clone3");
  if (clone3 != __NR_SCMP_ERROR) {
    int rc = seccomp_rule_add(ctx, SCMP_ACT_ERRNO(ENOSYS), clone3, 0);
    if (rc < 0) return fail("clone3", rc);
  }

  // clone's first argument is its flags on x86-64 and ARM64. One rule per
  // flag: refuse when that bit is set.
  const unsigned long namespace_flags[] = {
    CLONE_NEWNS, CLONE_NEWCGROUP, CLONE_NEWUTS, CLONE_NEWIPC,
    CLONE_NEWUSER, CLONE_NEWPID, CLONE_NEWNET,
  };
  for (unsigned long flag : namespace_flags) {
    int rc = seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(clone), 1,
                              SCMP_A0(SCMP_CMP_MASKED_EQ, flag, flag));
    if (rc < 0) return fail("clone namespace rule", rc);
  }

  int fd = open(output, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) {
    std::perror(output);
    return 1;
  }
  int rc = pfc ? seccomp_export_pfc(ctx, fd) : seccomp_export_bpf(ctx, fd);
  close(fd);
  seccomp_release(ctx);
  if (rc < 0) return fail("export", rc);
  return 0;
}
