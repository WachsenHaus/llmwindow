# LLM Window - VSCode 확장 프로그램


https://github.com/user-attachments/assets/4fbfdb4c-0ac9-4935-b7e9-f898fd524122


TypeScript/JavaScript 프로젝트에서 현재 활성화된 파일이 참조하는 모든 내부 코드를 하나의 텍스트 파일로 병합해주는 VSCode 확장 프로그램입니다.

## 주요 기능

### 1. TypeScript Alias 해석

- tsconfig.json의 baseUrl, paths 설정을 인식
- 예: `@renderer/*`와 같은 alias 경로를 실제 로컬 파일 경로로 올바르게 해석

### 2. Project References 지원

- 여러 개의 tsconfig.json을 참조하는 모노레포 구조 지원
- 예: tsconfig.node.json, tsconfig.web.json 등의 구조에서도 정확한 모듈 해석

### 3. 순환 참조 방지

```typescript
// 이미 방문한 파일이면 무시
if (visited.has(filePath)) {
  return '';
}
visited.add(filePath);
```

- visited Set을 사용하여 동일 파일의 중복 병합을 방지
- 무한 루프 방지 로직 구현

### 4. 라이브러리 코드 제외

- node_modules 경로의 외부 라이브러리 코드는 병합 대상에서 제외
- 프로젝트 내부 코드만 병합

### 5. 파일 구분 가시화

```typescript
// ========== SOURCE FILE: path/to/file.tsx ==========
// ========== END OF SOURCE FILE ==========
```

- 병합된 파일에 원본 파일 경로 표시
- 코드 가독성 향상
- 각 파일의 시작 부분에 구분 주석 자동 삽입
- 코드의 출처를 쉽게 파악 가능

## 사용 방법

1. VSCode에서 확장 프로그램 설치
2. 병합하고 싶은 TypeScript/JavaScript 파일을 엶
3. Command Palette(Ctrl+Shift+P / Cmd+Shift+P)에서 "Merge Files" 명령 실행
4. `원본파일명_merged.ts` 형태로 병합된 새 파일이 생성됨

## 활용 사례

이 도구는 특히 다음과 같은 상황에서 유용합니다:

- LLM(Large Language Model)에 코드를 입력할 때
- 프로젝트의 연관된 모든 코드를 한 번에 제공하고자 할 때
- 코드 리뷰나 분석을 위해 관련 코드를 한 눈에 보고 싶을 때

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/WachsenHaus/llmwindow/blob/HEAD/LICENSE) file for details.
