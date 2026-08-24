fn main() {
    if match_lens_lib::run_privileged_helper_if_requested() {
        return;
    }
    match_lens_lib::run();
}
