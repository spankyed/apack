# Literal multilingual retrieval and source highlights

[Run 41229932727](https://github.com/spankyed/apack/actions/runs/41229932727) executes all eight language/script cases on both adapters at 058f8d537c: Spanish, German, Greek, Cyrillic, Arabic, Chinese, Japanese and Korean. Every case retrieves its expected document and highlights the exact source token at valid UTF-16 offsets after an astral character. All eight pass on both backends.

Each backend passes 115/116 focused tests. Overall workflow remains red because of the unchanged generated-files overview relevance judgment. These literal cases do not establish stemming, language-specific segmentation, transliteration, broader relevance or complete language support. Later recovery and hybrid changes require their own qualification. The summary publishes inspected numeric/status metadata only; raw reports remain in workflow artifacts and the private local download.
