use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolsCommandPayload {
    pub request_id: String,
    pub command: String,
    pub action: String,
    #[serde(default)]
    pub params: Value,
}
