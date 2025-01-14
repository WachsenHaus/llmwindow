// src/mergeCommand.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';

export async function mergeAllFiles() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('현재 활성화된 에디터가 없습니다.');
    return;
  }
  const rootFilePath = editor.document.fileName;

  // 1) 최상위 tsconfig.json 찾기
  const rootTsconfigPath = findNearestTsconfig(rootFilePath);
  if (!rootTsconfigPath) {
    vscode.window.showWarningMessage(
      'tsconfig.json을 찾지 못했습니다. alias를 해석할 수 없습니다.'
    );
    return;
  }

  // 2) Project References(하위 tsconfig)까지 파싱
  const project = loadProjectTsconfigs(rootTsconfigPath);

  // 3) 현재 파일에 맞는 tsconfig(compilerOptions) 찾기
  const bestConfig = findBestTsconfigForFile(rootFilePath, project);
  const compilerOptions = bestConfig
    ? bestConfig.options
    : project.parsed.options;

  // 4) 재귀적으로 코드를 모아서 합침 (헤더 포함)
  const visited = new Set<string>();
  try {
    const mergedCode = gatherCodeRecursively(
      rootFilePath,
      visited,
      compilerOptions
    );

    // 5) 새 창에서 병합된 코드 보여주기
    const doc = await vscode.workspace.openTextDocument({
      content: mergedCode,
      language: 'typescript',
    });

    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside, // 현재 에디터 옆에 새 창으로 열기
    });

    vscode.window.showInformationMessage('코드 병합이 완료되었습니다.');
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `파일 병합 중 오류가 발생했습니다: ${error.message}`
    );
  }
}

/**
 * findNearestTsconfig
 * - 현재 파일 경로에서 상위 폴더로 올라가며 tsconfig.json이 있는지 탐색
 */
function findNearestTsconfig(startPath: string): string | null {
  let dir = path.dirname(startPath);
  while (true) {
    const tsconfig = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) {
      return tsconfig;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 프로젝트 전체 TSConfig 구조 (References 포함)
 */
interface TsconfigProject {
  configFilePath: string; // 최상위 tsconfig.json
  parsed: ts.ParsedCommandLine; // 최상위 parse 결과
  references: TsconfigReferenceInfo[]; // 하위 tsconfig 목록
}

interface TsconfigReferenceInfo {
  path: string;
  absolutePath: string;
  parsed: ts.ParsedCommandLine;
}

/**
 * loadProjectTsconfigs
 * - 최상위 tsconfig를 파싱하고, references가 있으면 각각도 파싱해 담아둔다.
 */
function loadProjectTsconfigs(rootTsconfigPath: string): TsconfigProject {
  const projectDir = path.dirname(rootTsconfigPath);

  // 1) 최상위 tsconfig.json
  const rootConfigRaw = ts.readConfigFile(rootTsconfigPath, ts.sys.readFile);
  const rootParsed = ts.parseJsonConfigFileContent(
    rootConfigRaw.config,
    ts.sys,
    projectDir
  );

  // 2) references
  const references: TsconfigReferenceInfo[] = [];
  const refDefs = rootConfigRaw.config.references || [];
  for (const refDef of refDefs) {
    const refAbsPath = path.resolve(projectDir, refDef.path);
    if (!fs.existsSync(refAbsPath)) {
      continue;
    }
    const subDir = path.dirname(refAbsPath);
    const subConfigRaw = ts.readConfigFile(refAbsPath, ts.sys.readFile);
    const subParsed = ts.parseJsonConfigFileContent(
      subConfigRaw.config,
      ts.sys,
      subDir
    );

    references.push({
      path: refDef.path,
      absolutePath: refAbsPath,
      parsed: subParsed,
    });
  }

  return {
    configFilePath: rootTsconfigPath,
    parsed: rootParsed,
    references,
  };
}

/**
 * findBestTsconfigForFile
 * - 현재 파일이 어떤 tsconfig(fileNames)에 포함되는지 찾는다.
 */
function findBestTsconfigForFile(
  filePath: string,
  project: TsconfigProject
): ts.ParsedCommandLine | null {
  const normFilePath = path.normalize(filePath);

  // 1) 최상위 tsconfig
  if (
    project.parsed.fileNames
      .map((f) => path.normalize(f))
      .includes(normFilePath)
  ) {
    return project.parsed;
  }

  // 2) references
  for (const ref of project.references) {
    const refFileNames = ref.parsed.fileNames.map((f) => path.normalize(f));
    if (refFileNames.includes(normFilePath)) {
      return ref.parsed;
    }
  }

  return null;
}

/**
 * gatherCodeRecursively
 * - AST로 import/export 구문을 찾고, TS 모듈 해석으로 로컬 파일을 찾는다.
 * - node_modules는 제외, 순환 참조 방지
 * - **헤더 주석**을 추가해서, "이 파일이 어디서 왔는지" 가시화
 */
function gatherCodeRecursively(
  filePath: string,
  visited: Set<string>,
  compilerOptions: ts.CompilerOptions
): string {
  // 이미 방문한 파일이면 무시
  if (visited.has(filePath)) {
    return '';
  }
  visited.add(filePath);

  // 확장자 보정
  const actualPath = fixFileExtension(filePath);
  if (!fs.existsSync(actualPath)) {
    return '';
  }

  // 소스 읽기
  const code = fs.readFileSync(actualPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    actualPath,
    code,
    ts.ScriptTarget.ES2020,
    true
  );

  // 1) import/export 경로 추출
  const importPaths = findImportPaths(sourceFile);

  // 2) import/export 구문 제거
  let strippedCode = removeImportStatements(sourceFile, code);

  // 3) **헤더**: 파일 분류를 위해 주석 형태로 삽입
  const fileHeader = `\n\n// ========== SOURCE FILE: ${actualPath} ==========\n\n`;
  let mergedResult = fileHeader + strippedCode;

  // 4) 각 importPath를 resolve
  for (const importPath of importPaths) {
    const resolvedFile = resolveModuleName(
      importPath,
      actualPath,
      compilerOptions
    );
    if (!resolvedFile) {
      // 못 찾으면 라이브러리 or 외부
      continue;
    }
    if (resolvedFile.includes('node_modules')) {
      // node_modules면 무시
      continue;
    }
    // 재귀 병합
    const childCode = gatherCodeRecursively(
      resolvedFile,
      visited,
      compilerOptions
    );

    // childCode에도 이미 해당 파일의 헤더가 들어있음
    mergedResult += '\n\n' + childCode;
  }

  return mergedResult;
}

/**
 * fixFileExtension
 * - ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs" 등 순회하며 실제 파일이 있는지 확인
 */
function fixFileExtension(filePath: string): string {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  if (fs.existsSync(filePath)) return filePath;

  for (const ext of exts) {
    const candidate = filePath + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return filePath; // 그래도 못 찾으면 그대로
}

/**
 * findImportPaths
 * - import ... from "xxx", export ... from "xxx" 구문에서 "xxx"만 추출
 */
function findImportPaths(sourceFile: ts.SourceFile): string[] {
  const results: string[] = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        results.push(node.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        results.push(node.moduleSpecifier.text);
      }
    }
  });

  return results;
}

/**
 * removeImportStatements
 * - AST 노드 범위를 사용해서 import/export 구문을 코드에서 제거
 */
function removeImportStatements(
  sourceFile: ts.SourceFile,
  originalCode: string
): string {
  const removals: Array<[number, number]> = [];

  sourceFile.forEachChild((node) => {
    // import ...
    if (ts.isImportDeclaration(node)) {
      removals.push([node.getStart(), node.getEnd()]);
    }
    // export ... from "..."
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      removals.push([node.getStart(), node.getEnd()]);
    }
  });

  // 뒤에서부터 잘라내기
  let result = originalCode;
  for (let i = removals.length - 1; i >= 0; i--) {
    const [start, end] = removals[i];
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/**
 * resolveModuleName
 * - TS Compiler API로 alias, baseUrl, paths 등을 해석
 */
function resolveModuleName(
  importPath: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions
): string | null {
  const resolved = ts.resolveModuleName(
    importPath,
    containingFile,
    compilerOptions,
    ts.sys
  );
  const resolvedModule = resolved.resolvedModule;
  if (!resolvedModule) {
    return null;
  }
  return resolvedModule.resolvedFileName;
}
