package com.asilism.zodiacblitz;

import android.os.Build;
import android.os.Bundle;
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
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false); // 엣지-투-엣지 — 웹뷰가 화면 전체를 쓴다
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 컷아웃(펀치홀) 영역까지 그린다 — 게임 배경이 노치 주변에서 끊겨 보이지 않게
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
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
