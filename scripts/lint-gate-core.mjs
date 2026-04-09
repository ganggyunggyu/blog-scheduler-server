import ts from 'typescript';

export const LINT_SCOPE_DIRECTORIES = ['src', 'test/unit'];

const CONSOLE_ALLOWLIST = new Set(['src/lib/logging/logger.ts']);
const TS_DIRECTIVE_RULES = [
  { pattern: /@ts-ignore\b/, rule: 'ts-ignore', message: '@ts-ignore is forbidden' },
  { pattern: /@ts-expect-error\b/, rule: 'ts-expect-error', message: '@ts-expect-error is forbidden' },
];

const createViolation = ({ line, column, rule, message }) => ({
  line,
  column,
  rule,
  message,
});

export const shouldLintFile = (relativePath) =>
  relativePath.endsWith('.ts') &&
  !relativePath.endsWith('.d.ts') &&
  LINT_SCOPE_DIRECTORIES.some((directory) => relativePath === directory || relativePath.startsWith(`${directory}/`));

export const lintFileText = (relativePath, sourceText) => {
  const violations = [];
  const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowConsole = CONSOLE_ALLOWLIST.has(relativePath);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sourceText);
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const commentText = scanner.getTokenText();
      for (const directiveRule of TS_DIRECTIVE_RULES) {
        if (directiveRule.pattern.test(commentText)) {
          const directiveIndex = commentText.indexOf('@ts-');
          const position = sourceFile.getLineAndCharacterOfPosition(scanner.getTokenPos() + directiveIndex);
          violations.push(
            createViolation({
              line: position.line + 1,
              column: position.character + 1,
              rule: directiveRule.rule,
              message: directiveRule.message,
            })
          );
        }
      }
    }

    token = scanner.scan();
  }

  const addNodeViolation = (node, rule, message) => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(
      createViolation({
        line: position.line + 1,
        column: position.character + 1,
        rule,
        message,
      })
    );
  };

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      addNodeViolation(node, 'explicit-any', 'Explicit any is forbidden');
    }

    if (ts.isFunctionDeclaration(node)) {
      addNodeViolation(node, 'function-declaration', 'Use arrow functions instead of function declarations');
    }

    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) {
      addNodeViolation(node, 'var', 'Use const or let instead of var');
    }

    if (
      !allowConsole &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console'
    ) {
      addNodeViolation(node.expression, 'no-console', 'Use the project logger instead of console');
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return violations.sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    return left.rule.localeCompare(right.rule);
  });
};
