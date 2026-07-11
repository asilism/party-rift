# 오픈소스 라이선스 고지 (Third-Party Notices)

조디악 블리츠(ZODIAC BLITZ)는 아래의 오픈소스 소프트웨어와 에셋을 사용합니다.
각 구성요소는 해당 라이선스 조건에 따라 배포물에 포함되어 있으며, 원저작자의 저작권은 각 저작권자에게 있습니다.

---

## MIT License 적용 구성요소

다음 구성요소들은 MIT 라이선스로 배포됩니다. 라이선스 전문은 이 절 끝에 있습니다.

- **React / React DOM / scheduler** — Copyright (c) Meta Platforms, Inc. and affiliates.
- **three.js** — Copyright © 2010-2026 three.js authors
- **Capacitor (@capacitor/core, @capacitor/android)** — Copyright 2017-present Drifty Co.
- **Electron** — Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.
  (데스크톱 배포판에는 Electron이 내장한 Chromium 등의 라이선스 파일 `LICENSE.electron.txt`, `LICENSES.chromium.html`이 함께 포함됩니다.)
- **ws** — Copyright (c) 2011 Einar Otto Stangvik (온라인 서버 구성에서만 사용)
- **js-tokens** — Copyright (c) 2014-2020 Simon Lydell
- **loose-envify** — Copyright (c) 2015 Andres Suarez
- **Microsoft Fluent Emoji (3D)** — Copyright (c) Microsoft Corporation.
  12지신 캐릭터 얼굴 이미지로 사용합니다. 일부 이모지는 게임 연출을 위해 잘라내거나(크롭) 좌우 반전하는 등 수정해 사용합니다.
  https://github.com/microsoft/fluentui-emoji

### MIT License 전문

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 0BSD 적용 구성요소

- **tslib** — Copyright (c) Microsoft Corporation. (BSD Zero Clause License — 고지 의무 없이 자유 사용 가능하나 참고로 기재)

---

## SIL Open Font License 1.1 적용 구성요소 (폰트)

- **Black Han Sans** — Copyright 2015 The Black Han Sans Project Authors (https://github.com/zesstype/Black-Han-Sans)
- **BM Jua (배달의민족 주아체)** — Copyright 2018 The BM JUA Project Authors

두 폰트는 SIL Open Font License 1.1 조건으로 앱에 임베드되어 있습니다.
폰트 자체를 단독으로 판매할 수 없으며, 라이선스 전문은 `src/assets/fonts/OFL.txt` 및 아래에 포함되어 있습니다.

### SIL Open Font License 1.1 전문

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

---

## Apache License 2.0 적용 구성요소 (안드로이드 배포판)

안드로이드 앱(APK/AAB)에는 AndroidX 라이브러리(appcompat, core, webkit, fragment,
coordinatorlayout, activity, core-splashscreen 등)가 포함되며, 이들은
Apache License 2.0으로 배포됩니다. — Copyright The Android Open Source Project

Apache License 2.0 전문: https://www.apache.org/licenses/LICENSE-2.0
(요구 조건에 따라 위 링크의 라이선스 전문이 본 고지의 일부를 구성합니다.
사용·수정·재배포 시 저작권 고지와 라이선스 사본 제공이 필요하며,
본 앱은 해당 라이브러리를 수정 없이 바이너리 형태로 포함합니다.)

---

## 기타

- 게임 내 효과음·배경음악은 Web Audio 신디사이저로 자체 생성한 것으로 외부 샘플을 사용하지 않습니다.
- 로고, 아이콘, 3D 모델(캐릭터·맵·괴수), UI 디자인은 자체 제작물입니다.
- 메뉴 화면 등 일부 UI의 이모지 문자는 사용자의 기기(OS)가 제공하는 이모지 폰트로 표시되며, 본 앱은 해당 폰트를 재배포하지 않습니다.
