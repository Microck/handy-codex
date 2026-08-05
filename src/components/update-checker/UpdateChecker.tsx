import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { arch, platform } from "@tauri-apps/plugin-os";
import { ProgressBar } from "../shared";
import { useSettings } from "../../hooks/useSettings";
import { commands } from "../../bindings";
import { PORTABLE_RELEASES_URL } from "./portableInstaller";

interface UpdateCheckerProps {
  className?: string;
}

const RELEASES_API_URL =
  "https://api.github.com/repos/Microck/handy-codex/releases/latest";

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

const compareVersions = (left: string, right: string): number => {
  const parse = (version: string) =>
    version
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) {
      return (a[index] ?? 0) - (b[index] ?? 0);
    }
  }
  return 0;
};

const findWindowsInstaller = (release: GitHubRelease, architecture: string) => {
  const suffix =
    architecture === "aarch64" ? "_arm64-setup.exe" : "_x64-setup.exe";
  return release.assets.find((asset) => asset.name.endsWith(suffix));
};

const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  // Update checking state
  const [isChecking, setIsChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [showPortableUpdateDialog, setShowPortableUpdateDialog] =
    useState(false);
  const [portableInstallerUrl, setPortableInstallerUrl] = useState<string>(
    PORTABLE_RELEASES_URL,
  );

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualCheckRef = useRef(false);

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      setIsChecking(false);
      setUpdateAvailable(false);
      setShowUpToDate(false);
      return;
    }

    checkForUpdates();

    // Listen for update check events
    const updateUnlisten = listen("check-for-updates", () => {
      handleManualUpdateCheck();
    });

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled]);

  // Update checking functions
  const checkForUpdates = async () => {
    if (!updateChecksEnabled || isChecking) return;

    try {
      setIsChecking(true);
      const [currentVersion, response] = await Promise.all([
        getVersion(),
        fetch(RELEASES_API_URL, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        }),
      ]);
      if (!response.ok) {
        throw new Error(`GitHub Releases returned HTTP ${response.status}`);
      }
      const release = (await response.json()) as GitHubRelease;
      const latestVersion = release.tag_name.replace(/^v/i, "");

      if (compareVersions(latestVersion, currentVersion) > 0) {
        setUpdateAvailable(true);
        setShowUpToDate(false);
        const installer =
          platform() === "windows"
            ? findWindowsInstaller(release, arch())
            : undefined;
        setPortableInstallerUrl(
          installer?.browser_download_url ?? release.html_url,
        );
      } else {
        setUpdateAvailable(false);

        if (isManualCheckRef.current) {
          setShowUpToDate(true);
          if (upToDateTimeoutRef.current) {
            clearTimeout(upToDateTimeoutRef.current);
          }
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
          }, 3000);
        }
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  };

  const handleManualUpdateCheck = () => {
    if (!updateChecksEnabled) return;
    isManualCheckRef.current = true;
    checkForUpdates();
  };

  const installUpdate = async () => {
    if (!updateChecksEnabled) return;

    const portable = await commands.isPortable();
    if (portable) {
      setShowPortableUpdateDialog(true);
      return;
    }

    try {
      setIsInstalling(true);
      setDownloadProgress(0);
      // Unsigned releases cannot be installed by Tauri's secure updater. Open
      // the matching GitHub installer instead; Windows can update the existing
      // installation when the user runs it after Handy exits.
      await openUrl(portableInstallerUrl);
    } catch (error) {
      console.error("Failed to install update:", error);
    } finally {
      setIsInstalling(false);
      setDownloadProgress(0);
    }
  };

  // Update status functions
  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) {
      return t("footer.updateCheckingDisabled");
    }
    if (isInstalling) {
      return downloadProgress > 0 && downloadProgress < 100
        ? t("footer.downloading", {
            progress: downloadProgress.toString().padStart(3),
          })
        : downloadProgress === 100
          ? t("footer.installing")
          : t("footer.preparing");
    }
    if (isChecking) return t("footer.checkingUpdates");
    if (showUpToDate) return t("footer.upToDate");
    if (updateAvailable) return t("footer.updateAvailableShort");
    return t("footer.checkForUpdates");
  };

  const getUpdateStatusAction = () => {
    if (!updateChecksEnabled) return undefined;
    if (updateAvailable && !isInstalling) return installUpdate;
    if (!isChecking && !isInstalling && !updateAvailable)
      return handleManualUpdateCheck;
    return undefined;
  };

  const isUpdateDisabled = !updateChecksEnabled || isChecking || isInstalling;
  const isUpdateClickable =
    !isUpdateDisabled && (updateAvailable || (!isChecking && !showUpToDate));

  // When no installer could be resolved for this target the button falls back to
  // the releases index, so the dialog has to say "browse" rather than "download".
  const hasDirectInstaller = portableInstallerUrl !== PORTABLE_RELEASES_URL;

  return (
    <>
      {showPortableUpdateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-mid-gray/20 rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h2 className="text-base font-semibold">
              {t("footer.portableUpdateTitle")}
            </h2>
            <p className="text-sm text-text/70">
              {hasDirectInstaller
                ? t("footer.portableUpdateMessage")
                : t("footer.portableUpdateBrowseMessage")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-sm rounded border border-mid-gray/20 hover:bg-mid-gray/10 transition-colors"
                onClick={() => setShowPortableUpdateDialog(false)}
              >
                {t("common.close")}
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded bg-logo-primary text-white hover:bg-logo-primary/80 transition-colors"
                onClick={() => {
                  openUrl(portableInstallerUrl);
                  setShowPortableUpdateDialog(false);
                }}
              >
                {hasDirectInstaller
                  ? t("footer.portableUpdateButton")
                  : t("footer.portableUpdateBrowseButton")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className={`flex items-center gap-3 ${className}`}>
        {isUpdateClickable ? (
          <button
            onClick={getUpdateStatusAction()}
            disabled={isUpdateDisabled}
            className={`transition-colors disabled:opacity-50 tabular-nums ${
              updateAvailable
                ? "text-logo-primary hover:text-logo-primary/80 font-medium"
                : "text-text/60 hover:text-text/80"
            }`}
          >
            {getUpdateStatusText()}
          </button>
        ) : (
          <span className="text-text/60 tabular-nums">
            {getUpdateStatusText()}
          </span>
        )}

        {isInstalling && downloadProgress > 0 && downloadProgress < 100 && (
          <ProgressBar
            progress={[
              {
                id: "update",
                percentage: downloadProgress,
              },
            ]}
            size="large"
          />
        )}
      </div>
    </>
  );
};

export default UpdateChecker;
