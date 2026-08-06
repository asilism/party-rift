package com.asilism.zodiacblitz;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Play Games Services v2 "저장된 게임"(Saved Games) — 클라우드 세이브 (Capacitor 8 앱 내장 플러그인).
 *
 * 기존 커뮤니티 플러그인이 Capacitor 8을 지원하지 않아 필요한 4개 메서드만 직접 감쌌다:
 * status / signIn / save / loadData. games-v2는 앱 시작 시 자동 로그인을 시도하므로
 * 대부분의 기기에서 사용자는 버튼 한 번 누를 일이 없다.
 *
 * 설정 게이트: res/values/strings.xml 의 game_services_project_id 가 "0"(자리표시자)이면
 * SDK를 초기화하지 않고 모든 호출이 available=false 로 답한다 — 콘솔에서 Play 게임 서비스
 * 프로젝트를 만들고 진짜 프로젝트 ID를 넣기 전까지 앱은 클라우드 없이 정상 동작한다.
 */
@CapacitorPlugin(name = "SavedGames")
public class SavedGamesPlugin extends Plugin {

    // 스냅샷 readFully()는 파일 IO — 메인 스레드 밖에서 읽는다
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private boolean configured() {
        String id = getContext().getString(R.string.game_services_project_id);
        return id != null && !id.isEmpty() && !"0".equals(id);
    }

    @Override
    public void load() {
        if (configured()) PlayGamesSdk.initialize(getContext()); // 자동 로그인 시도 포함
    }

    private Activity activityOr(PluginCall call) {
        Activity a = getActivity();
        if (a == null) call.reject("no activity");
        return a;
    }

    @PluginMethod
    public void status(PluginCall call) {
        Activity a = getActivity();
        if (!configured() || a == null) {
            JSObject r = new JSObject();
            r.put("available", false);
            r.put("signedIn", false);
            call.resolve(r);
            return;
        }
        PlayGames.getGamesSignInClient(a).isAuthenticated().addOnCompleteListener((task) -> {
            boolean ok = task.isSuccessful() && task.getResult() != null && task.getResult().isAuthenticated();
            JSObject r = new JSObject();
            r.put("available", true);
            r.put("signedIn", ok);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        Activity a = activityOr(call);
        if (a == null) return;
        if (!configured()) {
            call.reject("not configured");
            return;
        }
        PlayGames.getGamesSignInClient(a).signIn().addOnCompleteListener((task) -> {
            boolean ok = task.isSuccessful() && task.getResult() != null && task.getResult().isAuthenticated();
            JSObject r = new JSObject();
            r.put("signedIn", ok);
            call.resolve(r);
        });
    }

    // 스냅샷 저장 — open(자동 충돌 해소: 최근 수정본 승리) → writeBytes → commitAndClose
    @PluginMethod
    public void save(PluginCall call) {
        Activity a = activityOr(call);
        if (a == null) return;
        String name = call.getString("name", "zodiac-progress");
        String data = call.getString("data");
        if (data == null) {
            call.reject("no data");
            return;
        }
        SnapshotsClient sc = PlayGames.getSnapshotsClient(a);
        sc.open(name, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnFailureListener((e) -> call.reject("open failed: " + e.getMessage()))
            .addOnSuccessListener((doc) -> {
                Snapshot snap = doc.getData();
                if (snap == null) { // 정책상 자동 해소되지만 방어적으로
                    call.reject("conflict");
                    return;
                }
                snap.getSnapshotContents().writeBytes(data.getBytes(StandardCharsets.UTF_8));
                sc.commitAndClose(snap, SnapshotMetadataChange.EMPTY_CHANGE)
                    .addOnSuccessListener((md) -> call.resolve())
                    .addOnFailureListener((e) -> call.reject("commit failed: " + e.getMessage()));
            });
    }

    // 스냅샷 읽기 — 저장된 게 없으면 data:null (JS의 Plugin.load()와 이름이 겹쳐 loadData)
    @PluginMethod
    public void loadData(PluginCall call) {
        Activity a = activityOr(call);
        if (a == null) return;
        String name = call.getString("name", "zodiac-progress");
        SnapshotsClient sc = PlayGames.getSnapshotsClient(a);
        sc.open(name, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnFailureListener((e) -> call.reject("open failed: " + e.getMessage()))
            .addOnSuccessListener((doc) -> {
                Snapshot snap = doc.getData();
                if (snap == null) {
                    call.reject("conflict");
                    return;
                }
                IO.execute(() -> {
                    JSObject r = new JSObject();
                    try {
                        byte[] bytes = snap.getSnapshotContents().readFully();
                        r.put("data", bytes.length > 0 ? new String(bytes, StandardCharsets.UTF_8) : null);
                    } catch (IOException e) {
                        call.reject("read failed: " + e.getMessage());
                        return;
                    }
                    // 읽기 전용으로 열었어도 닫아 줘야 다음 open이 안 꼬인다
                    sc.discardAndClose(snap);
                    call.resolve(r);
                });
            });
    }
}
