// Release'da qo'shimcha konsol oynasi chiqmasligi uchun (Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    clary_desktop_lib::run()
}
