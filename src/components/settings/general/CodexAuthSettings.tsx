import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SettingContainer } from "../../ui/SettingContainer";

export const CodexAuthSettings: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const authFile = getSetting("codex_auth_file") ?? "";

  const chooseAuthFile = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Codex auth.json", extensions: ["json"] }],
    });

    if (typeof selected === "string") {
      await updateSetting("codex_auth_file", selected);
    }
  };

  const clearAuthFile = async () => {
    await updateSetting("codex_auth_file", null);
  };

  return (
    <SettingContainer
      title={t("settings.general.codexAuth.title")}
      description={t("settings.general.codexAuth.description")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          value={authFile}
          readOnly
          placeholder={t("settings.general.codexAuth.auto")}
          className="min-w-64 flex-1"
          variant="compact"
          aria-label={t("settings.general.codexAuth.title")}
        />
        <Button
          onClick={chooseAuthFile}
          disabled={isUpdating("codex_auth_file")}
          variant="secondary"
          size="md"
        >
          {t("settings.general.codexAuth.choose")}
        </Button>
        {authFile && (
          <Button
            onClick={clearAuthFile}
            disabled={isUpdating("codex_auth_file")}
            variant="ghost"
            size="md"
          >
            {t("settings.general.codexAuth.clear")}
          </Button>
        )}
      </div>
    </SettingContainer>
  );
});
