export function buildRoutineCurlExamples(fireUrl: string, token: string) {
  const authorization = `  -H 'Authorization: Bearer ${token}'`;

  return {
    minimal: [`curl -X POST '${fireUrl}' \\`, authorization].join("\n"),
    withText: [
      `curl -X POST '${fireUrl}' \\`,
      `${authorization} \\`,
      "  -H 'Content-Type: application/json' \\",
      `  -d '{"text":"本次任务信息"}'`,
    ].join("\n"),
  };
}
