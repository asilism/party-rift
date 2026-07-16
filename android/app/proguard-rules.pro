# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# 크래시 스택트레이스 해독용 — 줄 번호는 남기고 원본 파일명은 숨긴다.
#  (AAB에 mapping이 자동 동봉되어 Play Console 크래시 뷰가 원래 이름으로 풀어 보여줌)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# WebView JS 브리지(@JavascriptInterface)와 Capacitor 플러그인 keep 규칙은
# proguard-android-optimize.txt 기본 규칙 + Capacitor/AdMob의 consumerProguardFiles로 적용됨.
