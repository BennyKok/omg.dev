#ifndef NEEDLE_H
#define NEEDLE_H

#ifndef NEEDLE_API
#define NEEDLE_API __attribute__((visibility("default")))
#endif

#define NEEDLE_TEXT 1
#define NEEDLE_SPEECH 2

#ifdef __cplusplus
extern "C" {
#endif

/* One process-global, non-thread-safe model per kind, text and speech.
   Negative returns indicate failure; call needle_last_error() for the specific
   reason. needle_load reads whichever kind the .cact holds and keeps the other,
   so a build with both models takes one call per model. */
NEEDLE_API int needle_load(
    const unsigned char* cact,
    unsigned long long n
);

/* NEEDLE_TEXT, NEEDLE_SPEECH or both, for the models this process has loaded. */
NEEDLE_API int needle_models(void);

/* Last process-global error, owned by the runtime and valid until the next API call. */
NEEDLE_API const char* needle_last_error(void);

/* needle_init returns the tokenized static-prefix length on success. It can fail
   when the system prompt plus statically-declared tools exceed the context
   window, and reports the measured token count when it does. */
NEEDLE_API int needle_init(
    const char* system_prompt,
    const char* tools_json,
    const char* tool_index_path
);

/* Answers text or speech: exactly one of input and pcm is non-null. Given pcm,
   the engine transcribes the clip with the loaded speech model, answers the
   transcript, and merges the speech fields into the same JSON object under an
   audio_ prefix. needle_set_audio chooses how that transcription runs. */
NEEDLE_API int needle_complete(
    const char* input,
    const float* pcm,
    int samples,
    int max_new_tokens,
    char* out,
    int out_capacity
);

/* Language, keywords and word timestamps for the transcription needle_complete
   runs for itself, with the meanings they have in needle_transcribe. The
   strings are copied. Defaults: detect the language, no keywords, no times. */
NEEDLE_API void needle_set_audio(
    const char* language,
    const char* keywords,
    int word_timestamps
);

NEEDLE_API void needle_reset(void);

/* Transcribes 16 kHz mono float PCM in [-1, 1], at most 30 s, and returns the
   number of tokens generated. language is "en", "de", "fr", "es", "it", "nl" or
   "pl", or NULL to detect it. keywords is NULL or newline-separated words and
   phrases for keyword biasing. out receives JSON with the transcript, the
   language used, the milliseconds to the first token and the decoder's tokens
   per second after it; silence and steady noise give an empty text and language:
   {"text":"...","language":"en","ttft_ms":0.0,"decode_tps":0.0}
   A non-zero word_timestamps adds each word with times in seconds:
   "words":[{"word":"...","start":0.00,"end":0.00,"probability":0.000}] */
NEEDLE_API int needle_transcribe(
    const float* pcm,
    int samples,
    const char* language,
    const char* keywords,
    int word_timestamps,
    char* out,
    int out_capacity
);

/* Live transcription: appends 16 kHz mono float PCM, about one second at a
   time and at most 30 s per call, re-transcribes the buffered audio and commits
   the words two consecutive passes agree on. language and keywords are as in
   needle_transcribe. out receives the words this call committed, with times in
   seconds from the start of the stream, and the unconfirmed tail; returns the
   number of words committed:
   {"text":"...","words":[{"word":"...","start":0.00,"end":0.00,"probability":0.000}],
   "pending":"...","language":"en","received":0.00,"pass_ms":0.0} */
NEEDLE_API int needle_stream_transcribe_process(
    const float* pcm,
    int samples,
    const char* language,
    const char* keywords,
    char* out,
    int out_capacity
);

/* Ends the stream: the tail becomes the committed words of out, and the next
   needle_stream_transcribe_process starts a new stream. */
NEEDLE_API int needle_stream_transcribe_stop(
    char* out,
    int out_capacity
);

/* Embeds text or speech: exactly one of input and pcm is non-null. Text returns
   the model's embedding dimension, speech one row of that width per 80 ms frame,
   flattened. A null output returns the float count without computing. */
NEEDLE_API int needle_embed(
    const char* input,
    const float* pcm,
    int samples,
    float* out,
    int out_capacity
);

#ifdef __cplusplus
}
#endif
#endif
