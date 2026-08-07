package com.asilism.zodiacblitz;

import android.os.Build;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // 게임은 전체화면 몰입 모드 — 상태바·내비게이션 바를 숨기고, 가장자리 스와이프 시에만 잠깐 나타난다.
    // SDK 35+ 엣지-투-엣지 기본화 대응: 지원 중단된 systemUiVisibility 플래그 대신
    // WindowCompat/WindowInsetsControllerCompat(공식 이전 경로)을 쓴다.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SavedGamesPlugin.class); // ☁️ 클라우드 세이브 — super.onCreate 전에 등록해야 브리지에 잡힌다
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false); // 엣지-투-엣지 — 웹뷰가 화면 전체를 쓴다
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 컷아웃(펀치홀) 영역까지 그린다 — 게임 배경이 노치 주변에서 끊겨 보이지 않게
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    // ── 🎮 게임패드 네이티브 브리지 ──────────────────────────────────────
    // 안드로이드 시스템 웹뷰는 Gamepad API를 지원하지 않는다(getGamepads가 항상 비어 있음 —
    // 크롬 브라우저와 다르다). 대신 OS가 액티비티로 주는 KeyEvent/MotionEvent를 가로채
    // 웹뷰 JS(window.__zbPadAxes/__zbPadBtn — RiftControls의 셔틀)로 밀어 넣는다.

    private void padEval(String js) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(js, null); // dispatch류는 UI 스레드 — 바로 호출 가능
        }
    }

    // 표준 게임패드 매핑 인덱스로 변환 (A0 B1 X2 Y3 LB4 RB5 LT6 RT7 Select8 Start9 L3 R3)
    private int padButtonIndex(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            default: return -1;
        }
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        if ((ev.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            && ev.getAction() == MotionEvent.ACTION_MOVE) {
            float x = ev.getAxisValue(MotionEvent.AXIS_X);
            float y = ev.getAxisValue(MotionEvent.AXIS_Y);
            padEval("window.__zbPadAxes&&window.__zbPadAxes(" + x + "," + y + ")");
            return true;
        }
        return super.dispatchGenericMotionEvent(ev);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        if ((ev.getSource() & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD) {
            int idx = padButtonIndex(ev.getKeyCode());
            if (idx >= 0) {
                if (ev.getRepeatCount() == 0) { // OS 자동 반복은 무시 — 연타는 JS 쪽이 판단
                    boolean down = ev.getAction() == KeyEvent.ACTION_DOWN;
                    padEval("window.__zbPadBtn&&window.__zbPadBtn(" + idx + "," + down + ")");
                }
                return true; // 소비 — B 버튼이 뒤로가기 등으로 새지 않게
            }
        }
        return super.dispatchKeyEvent(ev);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); // 몰입 스티키와 동일
        }
    }
}
