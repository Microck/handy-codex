use anyhow::{Context, Result};
use reqwest::blocking::{multipart, Client};
use reqwest::header::{AUTHORIZATION, USER_AGENT};
use serde::Deserialize;
use serde_json::Value;
use std::io::Cursor;
use std::path::{Path, PathBuf};

pub const CODEX_ASR_ENDPOINT: &str = "https://chatgpt.com/backend-api/transcribe";
const DEFAULT_USER_AGENT: &str = "Codex Desktop/26.707.8479.0 (Windows; x64)";
const SAMPLE_RATE: u32 = 16_000;

#[derive(Clone, Debug)]
pub struct CodexAsrClient {
    auth_file: PathBuf,
    endpoint: String,
}

impl CodexAsrClient {
    pub fn new() -> Self {
        Self {
            auth_file: default_auth_file(),
            endpoint: CODEX_ASR_ENDPOINT.to_string(),
        }
    }

    pub fn with_auth_file(auth_file: impl Into<PathBuf>) -> Self {
        Self {
            auth_file: auth_file.into(),
            endpoint: CODEX_ASR_ENDPOINT.to_string(),
        }
    }

    pub fn transcribe(&self, audio: &[f32], language: &str) -> Result<String> {
        let auth = load_auth(&self.auth_file)?;
        let wav = encode_wav(audio)?;
        if wav.len() <= 44 {
            return Ok(String::new());
        }

        let file = multipart::Part::bytes(wav)
            .file_name("recording.wav")
            .mime_str("audio/wav")?;
        let mut form = multipart::Form::new().part("file", file);
        if language != "auto" && !language.trim().is_empty() {
            form = form.text("language", language.to_string());
        }

        let mut request = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()?
            .post(&self.endpoint)
            .header(AUTHORIZATION, format!("Bearer {}", auth.access_token))
            .header("originator", "Codex Desktop")
            .header(USER_AGENT, DEFAULT_USER_AGENT)
            .multipart(form);
        if let Some(account_id) = auth.account_id {
            request = request.header("ChatGPT-Account-Id", account_id);
        }

        let response = request.send()?;
        let status = response.status();
        let body = response.text()?;
        if !status.is_success() {
            let message = match status.as_u16() {
                401 | 403 => "Codex login expired; sign in again".to_string(),
                429 => "Codex transcription rate limit reached; try again later".to_string(),
                code => format!("Codex transcription failed with HTTP {code}"),
            };
            anyhow::bail!(message);
        }

        let response: TranscriptionResponse = serde_json::from_str(&body).with_context(|| {
            format!("Codex transcription returned invalid JSON: {}", clip(&body))
        })?;
        Ok(response.text.trim().to_string())
    }
}

impl Default for CodexAsrClient {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CodexAuth {
    pub(crate) access_token: String,
    pub(crate) account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: String,
}

pub(crate) fn default_auth_file() -> PathBuf {
    let manual_path = std::env::var_os("CODEX_ASR_AUTH_FILE").map(PathBuf::from);
    let codex_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
    let user_profile = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    resolve_auth_file(
        manual_path.as_deref(),
        codex_home.as_deref(),
        user_profile.as_deref(),
        home.as_deref(),
    )
}

fn resolve_auth_file(
    manual_path: Option<&Path>,
    codex_home: Option<&Path>,
    user_profile: Option<&Path>,
    home: Option<&Path>,
) -> PathBuf {
    manual_path
        .filter(|path| !path.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .or_else(|| codex_home.map(|path| path.join("auth.json")))
        .or_else(|| user_profile.map(|path| path.join(".codex").join("auth.json")))
        .or_else(|| home.map(|path| path.join(".codex").join("auth.json")))
        .unwrap_or_else(|| PathBuf::from(".codex").join("auth.json"))
}

pub(crate) fn load_auth(path: &Path) -> Result<CodexAuth> {
    let body = std::fs::read_to_string(path)
        .with_context(|| format!("Cannot read Codex login file: {}", path.display()))?;
    let root: Value = serde_json::from_str(&body).context("Codex login file is not valid JSON")?;
    let tokens = root
        .get("tokens")
        .context("Codex login file has no tokens object")?;
    let access_token = tokens
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .context("Codex login file has no access token")?
        .to_string();
    let account_id = tokens
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| account_id_from_jwt(&access_token));
    Ok(CodexAuth {
        access_token,
        account_id,
    })
}

fn account_id_from_jwt(access_token: &str) -> Option<String> {
    let payload = access_token.split('.').nth(1)?;
    let mut encoded = payload.replace('-', "+").replace('_', "/");
    encoded.push_str(&"=".repeat((4 - encoded.len() % 4) % 4));
    let bytes = base64_decode(&encoded)?;
    let payload: Value = serde_json::from_slice(&bytes).ok()?;
    payload
        .get("https://api.openai.com/auth")?
        .get("chatgpt_account_id")?
        .as_str()
        .map(str::to_string)
}

fn base64_decode(value: &str) -> Option<Vec<u8>> {
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;
    for byte in value.bytes() {
        let six = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(six);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(output)
}

fn encode_wav(audio: &[f32]) -> Result<Vec<u8>> {
    let mut output = Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(&mut output, spec)?;
    for sample in audio {
        writer.write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
    }
    writer.finalize()?;
    Ok(output.into_inner())
}

fn clip(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    if value.len() > 500 {
        format!("{}...", &value[..500])
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jwt_account_id_fallback_reads_chatgpt_claim() {
        let header = "eyJhbGciOiJub25lIn0";
        let payload = json!({
            "https://api.openai.com/auth": { "chatgpt_account_id": "acct_test" }
        });
        let encoded = base64_json(&payload);
        assert_eq!(
            account_id_from_jwt(&format!("{header}.{encoded}.sig")),
            Some("acct_test".into())
        );
    }

    #[test]
    fn wav_encoder_writes_pcm_wave_header() {
        let wav = encode_wav(&[0.0, 1.0, -1.0]).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(
            u32::from_le_bytes(wav[24..28].try_into().unwrap()),
            SAMPLE_RATE
        );
        assert_eq!(u16::from_le_bytes(wav[34..36].try_into().unwrap()), 16);
    }

    #[test]
    fn empty_audio_encodes_to_header_only() {
        assert_eq!(encode_wav(&[]).unwrap().len(), 44);
    }

    #[test]
    fn auth_path_uses_windows_userprofile_when_home_is_missing() {
        assert_eq!(
            resolve_auth_file(None, None, Some(Path::new(r"C:\Users\Microck")), None,),
            PathBuf::from(r"C:\Users\Microck\.codex\auth.json")
        );
    }

    #[test]
    fn manual_auth_path_takes_precedence_over_environment_paths() {
        assert_eq!(
            resolve_auth_file(
                Some(Path::new(r"D:\Shared\auth.json")),
                Some(Path::new(r"C:\Users\Microck\.codex")),
                Some(Path::new(r"C:\Users\Microck")),
                Some(Path::new(r"/home/microck")),
            ),
            PathBuf::from(r"D:\Shared\auth.json")
        );
    }

    fn base64_json(value: &Value) -> String {
        let bytes = serde_json::to_vec(value).unwrap();
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let a = chunk[0] as u32;
            let b = chunk.get(1).copied().unwrap_or(0) as u32;
            let c = chunk.get(2).copied().unwrap_or(0) as u32;
            out.push(alphabet[((a >> 2) & 63) as usize] as char);
            out.push(alphabet[(((a & 3) << 4) | (b >> 4)) as usize] as char);
            out.push(if chunk.len() > 1 {
                alphabet[(((b & 15) << 2) | (c >> 6)) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                alphabet[(c & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }
}
