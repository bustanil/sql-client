const clauses = ["select", "from", "where", "group by", "order by", "having", "limit", "offset", "join", "left join", "inner join"];

export function formatSQL(input: string) {
  const strings: string[] = [];
  let src = input.replace(/'(?:''|[^'])*'/g, (match) => {
    strings.push(match);
    return "§" + (strings.length - 1) + "§";
  });
  src = src.replace(/\s+/g, " ").trim().replace(/;\s*$/, "");
  for (const clause of ["order by", "group by", "left join", "inner join"]) {
    src = src.replace(new RegExp("\\b" + clause + "\\b", "ig"), "\n" + clause.toUpperCase());
  }
  for (const clause of clauses) {
    if (clause.includes(" ")) continue;
    src = src.replace(new RegExp("\\b" + clause + "\\b", "ig"), (match, offset) => (offset === 0 ? match.toUpperCase() : "\n" + match.toUpperCase()));
  }
  src = src
    .split("\n")
    .map((line, index) => (index === 0 ? line.trim() : "  " + line.trim()))
    .join("\n");
  strings.forEach((value, index) => {
    src = src.replace("§" + index + "§", value);
  });
  return input.trim().endsWith(";") ? src + ";" : src;
}
